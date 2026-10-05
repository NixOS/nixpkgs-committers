# Provides the dependencies for running scripts/retire-local.ts,
# see scripts/README.md
{
  pkgs ? import <nixpkgs> { },
}:
pkgs.mkShellNoCC {
  packages = [
    pkgs.nodejs
    pkgs.importNpmLock.hooks.linkNodeModulesHook
    pkgs.gh
  ];

  # Needs to be the real, writable dir 
  npmRoot = "scripts";

  npmDeps = pkgs.importNpmLock.buildNodeModules {
    inherit (pkgs) nodejs;
    # Needs to be an absolute path
    npmRoot = ./scripts;
  };
}
