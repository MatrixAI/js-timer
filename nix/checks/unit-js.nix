{
  pkgs,
  nodejs,
  system,
  src,
  setupDependencies,
  installedDependencies,
  libraryBuild,
}:
pkgs.stdenv.mkDerivation {
  pname = "timer-unit-js";
  version = "0.1.0";
  inherit src;
  nativeBuildInputs = [ nodejs ];
  dontBuild = true;
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    ${setupDependencies}
    # Vitest 5.1 hardcodes the TypeScript build-info path beside its own
    # distribution, independently of the configured Vitest cache directory.
    # Shared dependencies are symlinked into the read-only Nix store, so give
    # Vitest a writable sandbox-local copy while retaining the shared remainder.
    mkdir -p tmp/vitest
    cp -R ${installedDependencies}/node_modules/vitest tmp/vitest/package
    chmod -R u+w tmp/vitest/package
    rm node_modules/vitest
    ln -s ../tmp/vitest/package node_modules/vitest
    ln -s ${libraryBuild}/dist dist
    npm test -- --prebuilt
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/artifacts"
    cp -R tmp/junit "$out/artifacts/junit"
    cat > "$out/report.json" <<EOF
    {
      "schemaVersion": 1,
      "name": "unit-js",
      "kind": "unit-test",
      "status": "passed",
      "system": "${system}",
      "summary": "Node build and Vitest runtime and type cases passed",
      "artifacts": { "junit": "artifacts/junit" }
    }
    EOF
    runHook postInstall
  '';
}
