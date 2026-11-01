{
  pkgs,
  nodejs,
  package,
  packageLock,
  npmSources,
}:
let
  # Bind the importer's node-gyp/header substitutions to the check runtime too.
  npmConfigHook =
    (pkgs.callPackage (pkgs.path + /pkgs/build-support/node/import-npm-lock/hooks) {
      inherit nodejs;
    }).npmConfigHook;
  archives = pkgs.lib.mapAttrs (_: source: source.archive) npmSources;
  unpreparedGit = pkgs.lib.filterAttrs (
    modulePath: module: pkgs.lib.hasPrefix "git" (module.resolved or "") && !(archives ? ${modulePath})
  ) packageLock.packages;
in
assert
  unpreparedGit == { }
  || throw "Git dependencies require reviewed prepared archives: ${builtins.toJSON (builtins.attrNames unpreparedGit)}";
{
  inherit npmConfigHook;
  npmDeps = pkgs.importNpmLock {
    inherit package;
    # Source overrides invalidate any integrity belonging to the old source.
    packageLock = packageLock // {
      packages = pkgs.lib.mapAttrs (
        modulePath: module:
        if archives ? ${modulePath} then builtins.removeAttrs module [ "integrity" ] else module
      ) packageLock.packages;
    };
    packageSourceOverrides = archives;
  };
}
