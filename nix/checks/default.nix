{
  pkgs,
  nodejs,
  system,
  gitignore,
  npmDependencies,
}:
let
  src = gitignore.gitignoreSource ../..;
  inherit (npmDependencies) npmDeps npmConfigHook;
  runtimeInputs = {
    inherit
      pkgs
      nodejs
      system
      src
      npmDeps
      npmConfigHook
      ;
  };
  integration-browser = import ./integration-browser.nix runtimeInputs;
  verify = pkgs.buildNpmPackage {
    pname = "timer-verify";
    version = "0.1.0";
    inherit
      src
      nodejs
      npmDeps
      npmConfigHook
      ;
    nativeBuildInputs = [
      pkgs.shellcheck
      pkgs.nixfmt
    ];
    dontNpmBuild = true;
    doCheck = true;
    checkPhase = ''
      runHook preCheck
      npm run check
      runHook postCheck
    '';
    installPhase = ''
      runHook preInstall
      mkdir -p "$out/artifacts"
      cp -R tmp/junit "$out/artifacts/junit"
      cp -R tmp/package-candidate "$out/artifacts/package"
      cp tmp/portable-imports.json "$out/artifacts/portable-imports.json"
      cat > "$out/report.json" <<EOF
      {
        "schemaVersion": 1,
        "name": "verify",
        "kind": "conformance",
        "status": "passed",
        "system": "${system}",
        "summary": "Types, Jest/SWC unit tests, lint, emitted package, and portable timer source boundary passed",
        "artifacts": {
          "junit": "artifacts/junit",
          "package": "artifacts/package/report.json",
          "portableImports": "artifacts/portable-imports.json"
        }
      }
      EOF
      runHook postInstall
    '';
  };
in
{
  inherit verify;
  inherit integration-browser;
  runtime = pkgs.runCommand "timer-check-runtime" { } ''
    mkdir -p "$out/artifacts"
    ln -s ${integration-browser} "$out/artifacts/integration-browser"
    cat > "$out/report.json" <<EOF
    {
      "schemaVersion": 1,
      "name": "runtime",
      "kind": "aggregate",
      "status": "passed",
      "system": "${system}",
      "summary": "Chromium document and dedicated-worker integration passed; not deployed-platform evidence",
      "artifacts": {
        "browser": "artifacts/integration-browser/report.json"
      }
    }
    EOF
  '';
  default = pkgs.runCommand "timer-check-default" { } ''
    mkdir -p "$out/artifacts"
    ln -s ${verify} "$out/artifacts/verify"
    cat > "$out/report.json" <<EOF
    {
      "schemaVersion": 1,
      "name": "default",
      "kind": "aggregate",
      "status": "passed",
      "system": "${system}",
      "summary": "Routine timer verification passed",
      "artifacts": { "verify": "artifacts/verify/report.json" }
    }
    EOF
  '';
}
