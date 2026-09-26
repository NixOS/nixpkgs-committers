# Provides the dependencies for running scripts/retire-local.js,
# see scripts/README.md
{
  pkgs ? import <nixpkgs> { },
}:
pkgs.mkShellNoCC {
  packages = [
    pkgs.nodejs
    pkgs.gh
  ];
}
