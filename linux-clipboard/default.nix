{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.python3
    pkgs.gobject-introspection
    pkgs.python3Packages.pygobject3
    pkgs.gtk3 # Assuming you're using GTK3, include it or adjust according to your needs.
  ];

  shellHook = ''
    export GI_TYPELIB_PATH=$GI_TYPELIB_PATH:${pkgs.lib.makeSearchPath "lib/girepository-1.0" (with pkgs; [
      gobject-introspection
      gtk3
      # Add other libraries as needed
    ])}
  '';
}
