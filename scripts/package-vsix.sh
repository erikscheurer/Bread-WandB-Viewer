#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_argument="${1:-wandb-viewer.vsix}"
if [[ "${output_argument}" = /* ]]; then
    output_path="${output_argument}"
else
    output_path="${PWD}/${output_argument}"
fi

staging_root="$(mktemp -d /tmp/wandb-vsix-package.XXXXXX)"
trap 'rm -rf "${staging_root}"' EXIT

base_vsix="${staging_root}/base.vsix"
package_root="${staging_root}/package"
runtime_root="${package_root}/extension/node_modules"

cd "${repository_root}"
"${repository_root}/node_modules/.bin/vsce" package \
    --no-dependencies \
    --out "${base_vsix}"

mkdir -p "${package_root}"
unzip -q "${base_vsix}" -d "${package_root}"
mkdir -p "${runtime_root}/@protobufjs"

cp -R "${repository_root}/node_modules/protobufjs" "${runtime_root}/protobufjs"
cp -R "${repository_root}/node_modules/long" "${runtime_root}/long"

protobuf_helpers=(
    aspromise
    base64
    codegen
    eventemitter
    fetch
    float
    inquire
    path
    pool
    utf8
)
for helper in "${protobuf_helpers[@]}"; do
    cp -R \
        "${repository_root}/node_modules/@protobufjs/${helper}" \
        "${runtime_root}/@protobufjs/${helper}"
done

find "${runtime_root}" -type f \( -name '*.map' -o -name '*.ts' \) -delete

rm -f "${output_path}"
(
    cd "${package_root}"
    zip -qr "${output_path}" .
)

archive_listing="${staging_root}/archive-files.txt"
unzip -Z1 "${output_path}" > "${archive_listing}"

required_files=(
    extension/out/extension.js
    extension/node_modules/protobufjs/index.js
    extension/node_modules/long/index.js
)
for required_file in "${required_files[@]}"; do
    if ! grep -Fxq "${required_file}" "${archive_listing}"; then
        echo "Required VSIX file is missing: ${required_file}" >&2
        exit 1
    fi
done

if grep -Eq '(^|/)wandb/|(^|/)\.env$|\.map$|(^|/)telemetry/' \
        "${archive_listing}"; then
    echo 'VSIX contains a forbidden private or generated file.' >&2
    exit 1
fi

echo "Packaged and validated ${output_path}"
