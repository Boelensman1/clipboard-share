{
  description = "clipboard-share - share clipboard contents across machines over a WebSocket";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        pythonEnv = pkgs.python3.withPackages (ps: [ ps.pygobject3 ]);

        giTypelibPath = pkgs.lib.makeSearchPath "lib/girepository-1.0" [
          pkgs.gobject-introspection
          pkgs.gtk3
          pkgs.gtk4
          pkgs.glib
          pkgs.gdk-pixbuf
        ];

        clipboard-share = pkgs.buildNpmPackage (finalAttrs: {
          pname = "clipboard-share";
          version = "1.0.0";

          src = ./.;

          npmDeps = pkgs.importNpmLock { npmRoot = ./.; };
          npmConfigHook = pkgs.importNpmLock.npmConfigHook;

          dontNpmBuild = true;
          dontNpmInstall = true;

          npmFlags = [ "--ignore-scripts" ];

          nativeBuildInputs = [
            pkgs.nodejs_24
            pkgs.makeWrapper
          ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
            pythonEnv
          ] ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
            pkgs.swift
          ];

          buildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [
            pythonEnv
            pkgs.gobject-introspection
            pkgs.gtk3
            pkgs.gtk4
            pkgs.glib
          ];

          # Rewrite the four spawn sites to absolute store paths. The user will
          # `cd` into a directory containing config.json before running, so cwd
          # is not the install tree and the original `./linux-clipboard/...`
          # and `./macos-pasteboard/...` paths would not resolve.
          postPatch = ''
            libexec="${placeholder "out"}/libexec/clipboard-share"

            substituteInPlace lib/clipboard/linux/clipboardReader.mjs \
              --replace-fail "./linux-clipboard/clipboard-read.py" "$libexec/linux-clipboard/clipboard-read.py"

            substituteInPlace lib/clipboard/linux/clipboardWriter.mjs \
              --replace-fail "./linux-clipboard/clipboard-write.py" "$libexec/linux-clipboard/clipboard-write.py"

            substituteInPlace lib/clipboard/macos/clipboardReader.mjs \
              --replace-fail "./macos-pasteboard/bin/pbv" "$libexec/macos-pasteboard/bin/pbv"

            substituteInPlace lib/clipboard/macos/clipboardWriter.mjs \
              --replace-fail "./macos-pasteboard/bin/pbv" "$libexec/macos-pasteboard/bin/pbv"

            patchShebangs linux-clipboard/clipboard-read.py linux-clipboard/clipboard-write.py
          '';

          buildPhase = ''
            runHook preBuild
          '' + pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
            mkdir -p macos-pasteboard/bin
            swiftc -O macos-pasteboard/pbv.swift -o macos-pasteboard/bin/pbv
          '' + ''
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            root="$out/libexec/clipboard-share"
            mkdir -p "$root" "$out/bin"

            cp index.mjs server.mjs package.json "$root/"
            cp -r lib "$root/lib"
            cp -rL node_modules "$root/node_modules"
            cp -r linux-clipboard "$root/linux-clipboard"
            cp -r macos-pasteboard "$root/macos-pasteboard"

            makeWrapper ${pkgs.nodejs_24}/bin/node "$out/bin/clipboard-share" \
              --add-flags "$root/index.mjs"

            runHook postInstall
          '';

          postFixup = pkgs.lib.optionalString pkgs.stdenv.isLinux ''
            wrapProgram $out/bin/clipboard-share \
              --prefix GI_TYPELIB_PATH : "${giTypelibPath}"
          '';

          meta = with pkgs.lib; {
            description = "Share clipboard contents across machines over a WebSocket";
            license = licenses.isc;
            mainProgram = "clipboard-share";
            platforms = platforms.unix;
          };
        });
      in
      {
        packages.default = clipboard-share;
        packages.clipboard-share = clipboard-share;

        devShells.default = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 ]
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
              pythonEnv
              pkgs.gobject-introspection
              pkgs.gtk3
              pkgs.gtk4
              pkgs.glib
            ]
            ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
              pkgs.swift
            ];
          shellHook = pkgs.lib.optionalString pkgs.stdenv.isLinux ''
            export GI_TYPELIB_PATH=${giTypelibPath}''${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}
          '';
        };
      });
}
