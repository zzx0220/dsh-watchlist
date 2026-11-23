# Release runbook

One page for whoever cuts a release — the maintainer, or an agent acting for them.
Nothing here is optional except where it says so.

## Prerequisites

- Node 24+ and `npm` logged in as the publishing account (`npm whoami`).
- The repository on its release commit, working tree clean.
- The version in `package.json` is what you intend to publish. **A published version
  number can never be reused**, so check it twice.

## Cutting a release

```sh
cd dsh-watchlist

# 1. Checks: logic, client registration, syntax.
npm run check

# 2. Version and notes. The changelog entry is written before packing, so the tarball
#    and the tag describe the same thing.
#    Edit package.json "version", then add a "## <version> — <date>" section to
#    CHANGELOG.md.

# 3. Package and record the checksum. The tarball stays outside the repository.
npm pack --pack-destination ..
shasum -a 256 ../zzx0220-dsh-watchlist-<version>.tgz | tee ../SHA256SUMS

# 4. Prove the package installs on its own: throwaway profile, throwaway DSH_HOME,
#    then clean up. `--runtime` also boots the Host and asks the plugin's API.
node scripts/compat.mjs <latest-dsh-version> --runtime

# 5. Tag exactly the commit that was packed, then push both.
git add -A && git commit -m "Release <version>"
git tag -a v<version> -m "<version>: <one line>"
git push origin main
git push origin v<version>

# 6. Publish. `publishConfig.access: public` in package.json keeps a scoped package
#    from defaulting to restricted.
npm publish

# 7. Verify from the registry, not from the checkout: a fresh profile that installs
#    the package by name.
npm view @zzx0220/dsh-watchlist version
```

After publishing: confirm the npm page shows the README, the icon, and the repository
link; attach the tarball and `SHA256SUMS` to the GitHub release; mark the result in
`docs/TESTING.md` §10.

## When DeepSeek Harness ships a new version

```sh
node scripts/compat.mjs <new-version> --runtime
```

- Everything passes → widen `engines.dsh` (and the compatibility table in both READMEs)
  in the same commit, so the promise grows with the evidence.
- Anything fails → keep the range narrow. A refused install is a good outcome; a plugin
  that loads and misbehaves is not.

## What not to do

- Do not publish from a dirty working tree, or from a commit other than the tagged one.
- Do not move a tag that has been pushed. Bump the version instead.
- Do not republish a version to "fix" it; npm rejects it, and `--force` is not a thing
  for versions. Ship the next patch.
- Do not add a dependency for something the Host already provides (`@deepseek-ai/dsh-*`
  packages are peer dependencies, resolved by the running installation).
