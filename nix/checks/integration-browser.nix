{
  pkgs,
  nodejs,
  system,
  src,
  npmDeps,
  npmConfigHook,
}:
let
  playwright = pkgs.playwright-driver;
in
pkgs.buildNpmPackage {
  pname = "timer-integration-browser";
  version = "0.1.0";
  inherit
    src
    nodejs
    npmDeps
    npmConfigHook
    ;
  nativeCheckInputs = [ playwright.browsers ];
  CHECK_SYSTEM = system;
  CHECK_PLAYWRIGHT_VERSION = playwright.version;
  PLAYWRIGHT_BROWSERS_PATH = playwright.browsers;
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
  FONTCONFIG_FILE = pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; };
  dontNpmBuild = true;
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    export HOME="$TMPDIR/browser-home"
    mkdir -p "$HOME"
    timeout --signal=TERM --kill-after=10 180 npm run test:browser
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -R tmp/integration-browser/report.json tmp/integration-browser/artifacts "$out/"
    runHook postInstall
  '';
}
