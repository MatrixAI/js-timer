{
  pkgs,
  nodejs,
  lint,
  system,
  npmLibrary,
}:
let
  runtimeInputs = {
    inherit pkgs nodejs system;
    src = npmLibrary.src;
    setupDependencies = npmLibrary.setupDependencies;
  };
  browserBundle = import ./browser/bundle.nix (runtimeInputs // { npmBuild = npmLibrary.npmBuild; });
  integration-browser = import ./browser (runtimeInputs // { inherit browserBundle; });
  unit-js = import ./unit-js.nix {
    inherit pkgs nodejs system;
    src = npmLibrary.src;
    setupDependencies = npmLibrary.setupDependencies;
    installedDependencies = npmLibrary.installedDependencies;
    npmBuild = npmLibrary.npmBuild;
  };
  lintCheck = lint.mkCheck {
    src = npmLibrary.src;
    name = "timer-lint";
    npmDependencies = npmLibrary.npmDependencies // {
      inherit nodejs;
    };
  };
in
{
  lint = lintCheck;
  inherit unit-js;
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
    ln -s ${unit-js} "$out/artifacts/unit-js"
    ln -s ${lintCheck} "$out/artifacts/lint"
    cat > "$out/report.json" <<EOF
    {
      "schemaVersion": 1,
      "name": "default",
      "kind": "aggregate",
      "status": "passed",
      "system": "${system}",
      "summary": "Routine timer verification passed",
      "artifacts": {
        "unit-js": "artifacts/unit-js/report.json",
        "lint": "artifacts/lint/report.json"
      }
    }
    EOF
  '';
}
