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
          pkgs.glib.out
          pkgs.gdk-pixbuf.out
          pkgs.pango.out
          pkgs.graphene
          pkgs.harfbuzz.out
          pkgs.atk
        ];

        clipboard-share = pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "clipboard-share";
          version = "1.0.0";

          src = ./.;

          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            fetcherVersion = 4;
            hash = "sha256-zPavMSmbncX20dXMjkzreH4XVx78ppNPtREw2IoWpu0=";
          };

          nativeBuildInputs = [
            pkgs.nodejs_24
            pkgs.pnpm
            pkgs.pnpmConfigHook
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

          # The four spawn sites resolve themselves from import.meta.url, so no
          # rewriting is needed: ../../../ out of lib/clipboard/<platform>/ lands
          # on $out/libexec/clipboard-share, which is where installPhase puts
          # macos-pasteboard and linux-clipboard. Only the shebangs need fixing.
          postPatch = ''
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

            cp index.mjs server.mjs gen-cert.mjs package.json "$root/"
            cp -r lib "$root/lib"
            cp -rL node_modules "$root/node_modules"
            cp -r linux-clipboard "$root/linux-clipboard"
            cp -r macos-pasteboard "$root/macos-pasteboard"

            makeWrapper ${pkgs.nodejs_24}/bin/node "$out/bin/clipboard-share" \
              --add-flags "$root/index.mjs"

            makeWrapper ${pkgs.nodejs_24}/bin/node "$out/bin/clipboard-share-server" \
              --add-flags "$root/server.mjs"

            makeWrapper ${pkgs.nodejs_24}/bin/node "$out/bin/clipboard-share-gen-cert" \
              --add-flags "$root/gen-cert.mjs" \
              --prefix PATH : ${pkgs.openssl}/bin

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
          packages = [ pkgs.nodejs_24 pkgs.pnpm ]
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
