# OpenCV 5 as a private AWS Lambda tool

The capture agent sends a photograph to AWS Lambda. Lambda executes the shared
[`capture.measure()`](../capture.py), returns numeric image observations, and
returns the perspective-corrected JPEG when available. The agent uses those
observations to select its next tool call; the local review interface keeps the
original and the derived view together.

## Runtime and package

- **Runtime:** AWS Lambda `python3.13`, Amazon Linux 2023, `x86_64`.
- **Dependencies:** `numpy==2.5.3` and `opencv-python-headless==5.0.0.93`, from the
  shared [`requirements.txt`](../requirements.txt).
- **Wheel compatibility:** NumPy `cp313-cp313-manylinux_2_27/2_28_x86_64`;
  OpenCV `cp37-abi3-manylinux_2_28_x86_64`. Amazon Linux 2023 uses glibc 2.34.
- **Measured package:** 77,899,382 compressed bytes; 215,863,150 uncompressed bytes,
  including the two complete wheels, license files, handler, and capture module.
  AWS reports a 262,144,000-byte uncompressed quota. The package uses private S3
  staging because its compressed size exceeds the 52,428,800-byte direct upload
  quota. `build.json` records sizes and actual wheel tags for each rebuild.
- **Function:** 1,024 MiB memory, 30-second timeout, 512 MiB temporary disk.
  OpenCV uses two threads; OpenBLAS uses one.

AWS component scope: real image decoding, contour/edge measurements, focus
measurements, and perspective transformation. Source-image and derived-image
identifiers continue through the observation and the local review record.

## Build and deploy

Run from this `capture-loop` directory. Prerequisites: Python, `uv`, current AWS
CLI v2, and a short-term CLI session for an active AWS Free plan account with
Lambda, S3, IAM, and CloudWatch access. Set `WORK` to a temporary workspace path.

```bash
export WORK=/absolute/path/to/workspace/temp/capture-aws
export AWS_PROFILE=opencv-free
export AWS_REGION=ap-southeast-2
export CAPTURE_AWS_CLI=aws
# An existing CLI wrapper also works:
# export CAPTURE_AWS_CLI='/absolute/path/to/short-term-aws-wrapper'

python3 -B aws/build.py --output "$WORK/build"
python3 -B aws/manage.py deploy \
  --zip "$WORK/build/capture-measure.zip" \
  --state "$WORK/deployment.json" \
  --region "$AWS_REGION"
```

The builder resolves binary wheels for Python 3.13 and manylinux 2.28, independent
of the builder's Python version. It packages the current shared `capture.py`.

The deployer creates one function, a dedicated execution role, and a log group
with one-day retention. The role can create log streams and write events in that
function's log group. The temporary S3 bucket blocks public access; its ZIP uses
S3-managed AES-256 encryption. After the function becomes active, deployment
removes the ZIP object and the staging bucket. `deployment.json` records owned
resources and supports cleanup after a partial deployment.

### Update an existing measurement function

Rebuild the package after editing `capture.py`, then update through the same ownership record:

```bash
python3 -B aws/build.py --output "$WORK/build"
python3 -B aws/manage.py update \
  --zip "$WORK/build/capture-measure.zip" \
  --state "$WORK/deployment.json"
```

`update` reuses the recorded function, execution role and log group. It records the code update, waits for `function-updated-v2`, then removes its temporary S3 ZIP and bucket. The record remains usable by `cleanup`.

The recorded account's initial Lambda quota is 10 shared concurrent executions.
The client performs synchronous, sequential invocations through IAM-authenticated
`lambda:InvokeFunction`.

### Persistent service identity

For a hosted service that runs beyond an operator's CLI session, create a dedicated
IAM user from the deployment record. Its single inline policy grants
`lambda:InvokeFunction` on that exact function ARN. The resource ownership record
and environment file belong in private storage; temporary files go beneath `WORK`.

```bash
export PRIVATE=/absolute/path/to/private-storage
python3 -B aws/runtime_access.py create \
  --deployment "$WORK/deployment.json" \
  --state "$PRIVATE/capture-runtime.json" \
  --env-file "$PRIVATE/capture-runtime.env" \
  --work "$WORK/runtime-access"
```

Run this command with the operator's IAM administration session. The script tags
the owned user, records each resource step, checks the one-function policy and
active key, and writes private files with mode `0600`. Repeating `create` reuses
the identity and key. An interrupted key-creation step is recovered through the
owned user's key list; unusable orphan keys are revoked before a replacement.
`--work` shares a filesystem with the private files for atomic writes.

The generated file contains the access key, secret key, region, and
`AWS_EC2_METADATA_DISABLED=true`. A systemd unit can load it with
`EnvironmentFile=/absolute/path/to/private-storage/capture-runtime.env`.
Set `CAPTURE_AWS_CLI` to the plain AWS CLI executable for service invocations,
and set `CAPTURE_MEASURE_FUNCTION` to the deployed function name. The service
environment uses the dedicated key; administration continues through the
operator's short-term profile. Keep the generated environment and ownership
record in private storage and serve the capture application through its existing
request budget.

## Invoke from the agent or CLI

```bash
export CAPTURE_MEASURE_FUNCTION=dockproof-capture-measure
python3 -B aws/invoke.py \
  --source fixtures/datasheet001-frame-0022.png \
  --output "$WORK/frame22"
```

`invoke.py` accepts the same `--source` and `--output` options as `measure.py`.
It writes the returned perspective JPEG into `--output` and prints the
observation JSON. `execution` adds the AWS region, Python runtime, architecture,
and request ID for the tool trace. AWS standard profile and region environment
variables apply. `CAPTURE_AWS_CLI` accepts an executable path or a shell-split
command such as `bash /path/to/aws-wrapper.sh`.

The Lambda event is:

```json
{"filename":"photo.png","imageBase64":"BASE64_IMAGE_BYTES"}
```

A successful response contains `observation`, `execution`, and
`perspectiveJpegBase64` when `observation.perspectiveView` is present. Inputs are
JPEG/PNG images of 1–4,000,000 bytes, with at least 160 pixels on each side and
at most 24 million decoded pixels. The encoded request fits Lambda's 6 MiB
synchronous payload limit. Source and derived files exist within an invocation's
`/tmp` directory, which the handler removes on exit. The CLI's request and
response files use a temporary directory beneath `--output`, removed on exit.

## Recorded cloud check

On 2026-10-10, the deployed function processed natural fixture
`datasheet001-frame-0022.png` using Python **3.13.15** and OpenCV **5.0.0**.
It returned four interior corners, normalized-page focus **105.891**,
**193.2 px** of observed frame clearance, and a **183,517-byte** perspective JPEG.
The OpenCV measurement took **760.01 ms**. The response includes the AWS request
ID and runtime; [`recorded-invocation.json`](recorded-invocation.json) preserves
the measurement, package metadata, and existing invocation report.

### Parcel repair deployed

The **2026-10-11 (UTC+08)** update deployed the bounded-convex-hull repair, with Lambda `LastModified` **2026-10-10T18:03:12Z**. Both temporary staging resources were removed. The GLS photo produced four interior corners, normalized-page focus **340.928**, measured frame clearance **307 px**, and a **650.15 ms** OpenCV measurement. The live model opened field review, and a separate scripted browser review saved the handwritten date **12.08.2010**. A second independent cropped-label photo led to a recapture request.

[The parcel session](../evidence/parcel-cloud-loop.json) contains both AWS request IDs, all four native model requests and their actual tool results. [The acceptance record](../evidence/parcel-acceptance.json) includes updated package metadata and the browser checks.

On **2026-10-11 (UTC+08)**, the dedicated runtime identity invoked the GLS fixture
through the private Lambda interface. Its verified policy grants one action on
one function; the identity has one active key, one inline policy, zero managed
policies, and zero groups. The call returned four interior corners, focus
**340.928**, frame clearance **307 px**, and a **674.27 ms** OpenCV measurement.

## Cleanup

Stop the hosted service, then revoke its runtime key and remove the owned IAM
policy and user through an operator session:

```bash
python3 -B aws/runtime_access.py cleanup \
  --state "$PRIVATE/capture-runtime.json" \
  --work "$WORK/runtime-access"
```

This also removes the private environment file. Cleanup supports a partial create
and repeated runs; the ownership record stays available for the workspace lifecycle.
The Lambda's separate execution role is managed by the deployment command:

```bash
python3 -B aws/manage.py cleanup --state "$WORK/deployment.json"
```

Cleanup deletes the recorded function, log group, inline execution policy, and
role. The local build and deployment record stay in `WORK` for the operator's
workspace lifecycle.

References: [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html),
[Python runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-python.html),
[AWS Free plan](https://aws.amazon.com/free/).
