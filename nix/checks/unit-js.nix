{
  pkgs,
  nodejs,
  system,
  src,
  setupTestDependencies,
  testDependencies,
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
    ${setupTestDependencies}
    # Vitest writes its typecheck build info alongside its own distribution.
    mkdir -p tmp/vitest
    cp -R ${testDependencies}/node_modules/vitest tmp/vitest/package
    chmod -R u+w tmp/vitest/package
    rm node_modules/vitest
    ln -s ../tmp/vitest/package node_modules/vitest
    npm run build
    npm test
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
