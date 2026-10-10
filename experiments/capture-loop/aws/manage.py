#!/usr/bin/env python3
"""Deploy or remove one private OpenCV Lambda, with an ephemeral S3 ZIP upload."""
import argparse
import json
import os
import shlex
import subprocess
import time
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('action', choices=('deploy', 'update', 'cleanup'))
parser.add_argument('--zip', type=Path)
parser.add_argument('--state', type=Path, required=True, help='Local resource ownership record')
parser.add_argument('--function', default='dockproof-capture-measure')
parser.add_argument('--region', default=os.environ.get('AWS_REGION', 'ap-southeast-2'))
args = parser.parse_args()
base = shlex.split(os.environ.get('CAPTURE_AWS_CLI', 'aws'))


def aws(*params):
    result = subprocess.run(base + ['--region', args.region, '--no-cli-pager', '--output', 'json',
                                    *params], capture_output=True, text=True,
                            env=dict(os.environ, AWS_PAGER=''), timeout=180)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else {}


def save():
    args.state.parent.mkdir(parents=True, exist_ok=True)
    args.state.write_text(json.dumps(state, indent=2) + '\n')


def remove_staging():
    if state.get('stagingObject'):
        aws('s3api', 'delete-object', '--bucket', state['bucket'], '--key', state['key'])
        state['stagingObject'] = False
        save()
    if state.get('stagingBucket'):
        aws('s3api', 'delete-bucket', '--bucket', state['bucket'])
        state['stagingBucket'] = False
        save()


def upload_package():
    location = [] if args.region == 'us-east-1' else [
        '--create-bucket-configuration', 'LocationConstraint=' + args.region]
    aws('s3api', 'create-bucket', '--bucket', state['bucket'], *location)
    state['stagingBucket'] = True
    save()
    aws('s3api', 'put-public-access-block', '--bucket', state['bucket'],
        '--public-access-block-configuration', json.dumps({
            'BlockPublicAcls': True, 'IgnorePublicAcls': True,
            'BlockPublicPolicy': True, 'RestrictPublicBuckets': True}))
    aws('s3api', 'put-object', '--bucket', state['bucket'], '--key', state['key'],
        '--body', str(args.zip.resolve()), '--server-side-encryption', 'AES256')
    state['stagingObject'] = True
    save()


if args.action == 'cleanup':
    state = json.loads(args.state.read_text())
    args.region = state['region']
    remove_staging()
    for flag, command in [
        ('functionCreated', ('lambda', 'delete-function', '--function-name', state['function'])),
        ('logGroupCreated', ('logs', 'delete-log-group', '--log-group-name', state['logGroup'])),
        ('rolePolicyCreated', ('iam', 'delete-role-policy', '--role-name', state['role'],
                               '--policy-name', 'capture-logs')),
        ('roleCreated', ('iam', 'delete-role', '--role-name', state['role'])),
    ]:
        if state.get(flag):
            aws(*command)
            state[flag] = False
            save()
    state['status'] = 'deleted'
    save()
    print(json.dumps({'function': state['function'], 'status': 'deleted'}))
    raise SystemExit(0)

if args.zip is None or not args.zip.is_file():
    parser.error(f'{args.action} requires --zip pointing to the built deployment package.')
if args.action == 'update':
    state = json.loads(args.state.read_text())
    args.region = state['region']
    if not state.get('functionCreated'):
        parser.error('update requires a deployment record with an existing function.')
    remove_staging()
    try:
        upload_package()
        function = aws('lambda', 'update-function-code', '--function-name', state['function'],
                       '--s3-bucket', state['bucket'], '--s3-key', state['key'])
        state.update(status='Updating', codeSha256=function['CodeSha256'],
                     lastModified=function['LastModified'])
        save()
        aws('lambda', 'wait', 'function-updated-v2', '--function-name', state['function'])
        state['status'] = 'Active'
        save()
    finally:
        remove_staging()
    print(json.dumps({'function': state['function'], 'region': state['region'],
                      'status': state['status'], 'lastModified': state['lastModified'],
                      'stagingRemoved': True}))
    raise SystemExit(0)
if args.state.exists():
    parser.error('Choose a fresh --state file; use cleanup with the existing resource record.')
account = aws('sts', 'get-caller-identity')['Account']
state = {'region': args.region, 'function': args.function, 'role': args.function + '-role',
         'logGroup': '/aws/lambda/' + args.function,
         'bucket': f'{args.function}-deploy-{account}-{args.region}', 'key': 'capture-measure.zip',
         'memoryMiB': 1024, 'timeoutSeconds': 30, 'architecture': 'x86_64', 'runtime': 'python3.13'}
save()
trust = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow',
         'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole'}]}
role = aws('iam', 'create-role', '--role-name', state['role'],
           '--assume-role-policy-document', json.dumps(trust))['Role']['Arn']
state.update(roleArn=role, roleCreated=True)
save()
policy = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow',
          'Action': ['logs:CreateLogStream', 'logs:PutLogEvents'],
          'Resource': f'arn:aws:logs:{args.region}:{account}:log-group:{state["logGroup"]}:*'}]}
aws('iam', 'put-role-policy', '--role-name', state['role'], '--policy-name', 'capture-logs',
    '--policy-document', json.dumps(policy))
state['rolePolicyCreated'] = True
save()
aws('logs', 'create-log-group', '--log-group-name', state['logGroup'])
state['logGroupCreated'] = True
save()
aws('logs', 'put-retention-policy', '--log-group-name', state['logGroup'], '--retention-in-days', '1')
try:
    upload_package()
    for attempt in range(4):
        try:
            function = aws('lambda', 'create-function', '--function-name', state['function'],
                '--runtime', state['runtime'], '--architectures', state['architecture'],
                '--role', role, '--handler', 'handler.lambda_handler',
                '--code', json.dumps({'S3Bucket': state['bucket'], 'S3Key': state['key']}),
                '--timeout', '30', '--memory-size', '1024',
                '--ephemeral-storage', '{"Size":512}',
                '--environment', json.dumps({'Variables': {
                    'OPENCV_IO_MAX_IMAGE_PIXELS': '24000000', 'OPENBLAS_NUM_THREADS': '1'}}),
                '--description', 'OpenCV 5 document measurements for the DockProof capture agent',
                '--tags', 'Project=DockProof,Component=opencv5-capture-measure')
            break
        except RuntimeError as exc:
            if 'InvalidParameterValueException' in str(exc) and 'role' in str(exc).lower() and attempt < 3:
                time.sleep(5)
                continue
            raise
    state.update(functionCreated=True, functionArn=function['FunctionArn'])
    save()
    aws('lambda', 'wait', 'function-active-v2', '--function-name', state['function'])
    state['status'] = 'Active'
    save()
finally:
    remove_staging()
print(json.dumps({'function': state['function'], 'region': state['region'], 'status': state['status'],
                  'runtime': state['runtime'], 'memoryMiB': state['memoryMiB'],
                  'stagingRemoved': True}))
