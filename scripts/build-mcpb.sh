#!/usr/bin/env bash
# Builds the Claude Desktop extension bundle (MCPB): build/proofread-mcp-<version>.mcpb
# The bundle = the npm tarball contents + production node_modules + manifest.json + icon.png.
# It is attached to the GitHub release, never shipped in the npm package.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
manifest_version=$(node -p "require('./manifest.json').version")
if [ "$version" != "$manifest_version" ]; then
  echo "package.json is $version but manifest.json is $manifest_version" >&2
  exit 1
fi
npm run build
rm -rf build/mcpb && mkdir -p build/mcpb
tarball=$(npm pack --pack-destination build --silent)
tar -xzf "build/$tarball" -C build/mcpb --strip-components=1
rm -f "build/$tarball"
(cd build/mcpb && npm install --omit=dev --ignore-scripts --no-audit --no-fund --silent)
cp manifest.json icon.png build/mcpb/
npx -y @anthropic-ai/mcpb validate build/mcpb/manifest.json
out="build/proofread-mcp-$version.mcpb"
rm -f "$out"
npx -y @anthropic-ai/mcpb pack build/mcpb "$out"
npx -y @anthropic-ai/mcpb info "$out"
echo "built $out"
