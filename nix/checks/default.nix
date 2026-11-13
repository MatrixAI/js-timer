{
  pkgs,
  nodejs,
  lint,
  system,
  gitignore,
  npmDependencies,
}:
let
  src = gitignore.gitignoreSource ../..;
  inherit (npmDependencies) npmDeps npmConfigHook;
  testDependencies = pkgs.buildNpmPackage {
    pname = "library-test-npm-dependencies";
    version = "0";
    src = npmDeps;
    inherit nodejs npmDeps npmConfigHook;
    dontNpmBuild = true;
    dontFixup = true;
    installPhase = ''
      mkdir -p "$out"
      mv node_modules "$out/node_modules"
    '';
  };
  setupTestDependencies = ''
    mkdir node_modules
    find ${testDependencies}/node_modules -mindepth 1 -maxdepth 1 \
      -exec ln -s -t node_modules {} +
    export PATH="$PWD/node_modules/.bin:$PATH"
  '';
  runtimeInputs = {
    inherit
      pkgs
      nodejs
      system
      src
      setupTestDependencies
      ;
  };
  browserBundle = import ./browser/bundle.nix runtimeInputs;
  integration-browser = import ./browser (runtimeInputs // { inherit browserBundle; });
  unit-js = import ./unit-js.nix {
    inherit
      pkgs
      nodejs
      system
      src
      setupTestDependencies
      testDependencies
      ;
  };
  lintCheck = lint.mkCheck {
    inherit src;
    name = "timer-lint";
    npmDependencies = npmDependencies // {
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
