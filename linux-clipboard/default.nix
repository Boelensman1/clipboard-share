{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.python3
    pkgs.gobject-introspection
    pkgs.python3Packages.pygobject3
    pkgs.gtk3
    pkgs.gtk4
  ];

  shellHook = ''
    export GI_TYPELIB_PATH=$GI_TYPELIB_PATH:${pkgs.lib.makeSearchPath "lib/girepository-1.0" (with pkgs; [
      gobject-introspection
      gtk3
      gtk4
      # Add other libraries as needed
    ])}
  '';
}
