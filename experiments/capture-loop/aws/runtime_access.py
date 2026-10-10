#!/usr/bin/env python3
"""Create or clean up a single-function IAM identity for a private capture service."""
import argparse
import json
import os
import re
import shlex
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote


class AccessError(Exception):
    def __init__(self, code, operation, detail=''):
        self.code, self.operation, self.detail = code, operation, detail
        super().__init__(code)


def now():
    return datetime.now(timezone.utc).isoformat()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('create', 'cleanup'))
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--deployment', type=Path)
    parser.add_argument('--env-file', type=Path)
    parser.add_argument('--work', type=Path, required=True,
                        help='Temporary directory on the same filesystem as private state')
    parser.add_argument('--user', default='dockproof-capture-runtime')
    args = parser.parse_args()
    os.umask(0o077)
    args.state = args.state.resolve()
    args.work.mkdir(parents=True, exist_ok=True, mode=0o700)
    base = shlex.split(os.environ.get('CAPTURE_AWS_CLI', 'aws'))
    state = json.loads(args.state.read_text()) if args.state.exists() else None

    def write_private(path, text):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, temporary = tempfile.mkstemp(prefix='capture-runtime-', dir=args.work)
        try:
            with os.fdopen(fd, 'w') as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(text)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def save(step=None):
        if step:
            state['step'] = step
        state['updatedAt'] = now()
        write_private(args.state, json.dumps(state, indent=2) + '\n')

    def aws(*params, missing_ok=False):
        result = subprocess.run(base + ['--region', state['region'], '--no-cli-pager',
                                        '--output', 'json', *params],
                                capture_output=True, text=True, timeout=120,
                                env=dict(os.environ, AWS_PAGER=''))
        if result.returncode:
            match = re.search(r'An error occurred \(([^)]+)\)', result.stderr)
            code = match.group(1) if match else 'AwsCliFailed'
            if missing_ok and code == 'NoSuchEntity':
                return None
            raise AccessError(code, ' '.join(params[:2]), result.stderr.strip())
        return json.loads(result.stdout) if result.stdout.strip() else {}

    def owned_user():
        user = aws('iam', 'get-user', '--user-name', state['userName'], missing_ok=True)
        if user is None:
            return None
        tags = aws('iam', 'list-user-tags', '--user-name', state['userName'])['Tags']
        tags = {tag['Key']: tag['Value'] for tag in tags}
        if tags.get('CaptureRuntimeOwner') != state['ownershipId']:
            raise AccessError('OwnershipMismatch', 'iam get-user')
        if state.get('userId') and user['User']['UserId'] != state['userId']:
            raise AccessError('UserIdMismatch', 'iam get-user')
        return user['User']

    def keys():
        return aws('iam', 'list-access-keys', '--user-name', state['userName'])['AccessKeyMetadata']

    def delete_key(key):
        save('delete-access-key')
        aws('iam', 'delete-access-key', '--user-name', state['userName'],
            '--access-key-id', key['AccessKeyId'], missing_ok=True)
        state['deletedKeyCount'] = state.get('deletedKeyCount', 0) + 1
        save()

    def policy_check():
        names = aws('iam', 'list-user-policies', '--user-name', state['userName'])['PolicyNames']
        attached = aws('iam', 'list-attached-user-policies',
                       '--user-name', state['userName'])['AttachedPolicies']
        groups = aws('iam', 'list-groups-for-user', '--user-name', state['userName'])['Groups']
        if attached or groups or set(names) - {state['policyName']}:
            raise AccessError('UnexpectedPermissions', 'verify identity permissions')
        return names

    try:
        if args.action == 'cleanup' and state is None:
            print(json.dumps({'status': 'absent'}))
            return 0
        if args.action == 'create':
            if not args.deployment or not args.env_file:
                parser.error('create requires --deployment and --env-file')
            deployment = json.loads(args.deployment.read_text())
            arn = deployment['functionArn']
            if not deployment.get('functionCreated') or '*' in arn or ':function:' not in arn:
                raise AccessError('InvalidDeployment', 'read deployment')
            expected = {'userName': args.user, 'functionArn': arn,
                        'region': deployment['region'],
                        'environmentFile': str(args.env_file.resolve())}
            if state:
                if any(state.get(key) != value for key, value in expected.items()):
                    raise AccessError('StateMismatch', 'read ownership record')
            else:
                state = dict(expected, schema=1, ownershipId=uuid.uuid4().hex,
                             policyName='capture-invoke-one', createdAt=now())
            state.update(status='creating')
            state.pop('lastError', None)
            save('inspect-user')
        else:
            save('cleanup-user')

        env_file = Path(state['environmentFile'])
        user = owned_user()
        if args.action == 'cleanup':
            if user:
                for key in keys():
                    delete_key(key)
                env_file.unlink(missing_ok=True)
                state.update(credentialsReady=False, accessKeyId=None)
                save('delete-policy')
                aws('iam', 'delete-user-policy', '--user-name', state['userName'],
                    '--policy-name', state['policyName'], missing_ok=True)
                state['policyCreated'] = False
                save('delete-user')
                aws('iam', 'delete-user', '--user-name', state['userName'], missing_ok=True)
            env_file.unlink(missing_ok=True)
            state.update(status='deleted', userCreated=False, policyCreated=False,
                         credentialsReady=False, accessKeyId=None, pendingKeyCreate=False)
            state.pop('lastError', None)
            save('complete')
            print(json.dumps({'status': 'deleted', 'credentialsRemoved': True}))
            return 0

        if user is None:
            save('create-user')
            tags = [{'Key': 'Project', 'Value': 'DockProof'},
                    {'Key': 'Component', 'Value': 'opencv5-capture-runtime'},
                    {'Key': 'CaptureRuntimeOwner', 'Value': state['ownershipId']}]
            user = aws('iam', 'create-user', '--user-name', state['userName'],
                       '--tags', json.dumps(tags))['User']
        state.update(userCreated=True, userId=user['UserId'])
        save('inspect-permissions')
        policy_check()
        policy = {'Version': '2012-10-17', 'Statement': [{
            'Effect': 'Allow', 'Action': 'lambda:InvokeFunction',
            'Resource': state['functionArn']}]}
        save('put-policy')
        aws('iam', 'put-user-policy', '--user-name', state['userName'],
            '--policy-name', state['policyName'], '--policy-document', json.dumps(policy))
        state['policyCreated'] = True
        save('verify-policy')
        actual = aws('iam', 'get-user-policy', '--user-name', state['userName'],
                     '--policy-name', state['policyName'])['PolicyDocument']
        if isinstance(actual, str):
            actual = json.loads(unquote(actual))
        if actual != policy:
            raise AccessError('PolicyMismatch', 'verify single-function policy')
        policy_check()

        existing = keys()
        env = {}
        if env_file.exists():
            env_file.chmod(0o600)
            env = dict(line.split('=', 1) for line in env_file.read_text().splitlines()
                       if '=' in line)
        current = next((key for key in existing
                        if key['AccessKeyId'] == env.get('AWS_ACCESS_KEY_ID')), None)
        if current and env.get('AWS_SECRET_ACCESS_KEY'):
            if len(existing) != 1:
                raise AccessError('UnexpectedAccessKeys', 'inspect access keys')
            if current['Status'] != 'Active':
                save('activate-key')
                aws('iam', 'update-access-key', '--user-name', state['userName'],
                    '--access-key-id', current['AccessKeyId'], '--status', 'Active')
            key_id = current['AccessKeyId']
        else:
            # A lost create response leaves a recoverable orphan under this tagged user.
            for key in existing:
                if state.get('pendingKeyCreate') or key['AccessKeyId'] == state.get('accessKeyId'):
                    delete_key(key)
                else:
                    raise AccessError('UnexpectedAccessKeys', 'inspect access keys')
            env_file.unlink(missing_ok=True)
            state.update(credentialsReady=False, pendingKeyCreate=True, accessKeyId=None)
            save('create-access-key')
            key = aws('iam', 'create-access-key', '--user-name', state['userName'])['AccessKey']
            key_id = key['AccessKeyId']
            env = {'AWS_ACCESS_KEY_ID': key_id, 'AWS_SECRET_ACCESS_KEY': key['SecretAccessKey'],
                   'AWS_REGION': state['region'], 'AWS_DEFAULT_REGION': state['region'],
                   'AWS_EC2_METADATA_DISABLED': 'true'}
        env = {'AWS_ACCESS_KEY_ID': key_id, 'AWS_SECRET_ACCESS_KEY': env['AWS_SECRET_ACCESS_KEY'],
               'AWS_REGION': state['region'], 'AWS_DEFAULT_REGION': state['region'],
               'AWS_EC2_METADATA_DISABLED': 'true'}
        write_private(env_file, ''.join(f'{name}={value}\n' for name, value in env.items()))
        state.update(accessKeyId=key_id, credentialsReady=True, pendingKeyCreate=False)
        save('verify-key')
        actual_keys = keys()
        if len(actual_keys) != 1 or actual_keys[0]['AccessKeyId'] != key_id or actual_keys[0]['Status'] != 'Active':
            raise AccessError('KeyVerificationFailed', 'verify active access key')
        state.update(status='ready', verifiedAt=now(),
                     verification={'singleFunctionInvoke': True, 'inlinePolicies': 1,
                                   'managedPolicies': 0, 'groups': 0, 'activeKeys': 1})
        save('complete')
        print(json.dumps({'status': 'ready', 'permission': 'lambda:InvokeFunction',
                          'functionCount': 1, 'activeKeys': 1,
                          'environmentFile': str(env_file)}))
        return 0
    except (AccessError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        detail = {'code': getattr(error, 'code', type(error).__name__),
                  'operation': getattr(error, 'operation', 'local runtime access'),
                  'detail': getattr(error, 'detail', str(error)), 'at': now()}
        if state is not None:
            state.update(status='failed', lastError=detail)
            save()
        print(json.dumps({'status': 'failed', 'code': detail['code'],
                          'operation': detail['operation'], 'state': str(args.state)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
