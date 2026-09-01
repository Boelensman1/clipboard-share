using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace ClipboardShare
{
    /// <summary>
    /// Windows clipboard helper for clipboard-share. Speaks the same JSON-lines
    /// protocol over stdio as the macOS (pbv) and Linux (GTK) helpers:
    ///
    ///   a line is a JSON array of [mimeType, base64] pairs, e.g.
    ///   [["text/plain","aGk="],["image/png","..."]]
    ///
    /// Modes:
    ///   --watch  event-driven clipboard reader; prints one JSON line per change.
    ///   --set    reads one JSON line from stdin and sets the clipboard.
    ///
    /// Supported MIME types (full parity with the other platforms):
    ///   text/plain     &lt;-&gt; CF_UNICODETEXT
    ///   image/png      &lt;-&gt; the registered "PNG" clipboard format (+ a Bitmap
    ///                       for apps that only take CF_DIB/CF_BITMAP)
    ///   text/uri-list  &lt;-&gt; CF_HDROP (a single file:// URL &lt;-&gt; local path)
    /// </summary>
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            var mode = "";
            foreach (var a in args)
            {
                if (a == "--set" || a == "-p") mode = "set";
                else if (a == "--watch" || a == "-s") mode = "watch";
            }

            switch (mode)
            {
                case "set":
                    SetClipboard();
                    return 0;
                case "watch":
                    Watch();
                    return 0;
                default:
                    Console.Error.WriteLine("Usage: clipboard.exe --watch | --set");
                    return 1;
            }
        }

        // ----- reader (--watch) --------------------------------------------

        private static void Watch()
        {
            // Keep the watcher alive for the lifetime of the message loop.
            using (var watcher = new ClipboardWatcher())
            {
                // Pump the Win32 message queue so WM_CLIPBOARDUPDATE is delivered.
                // We intentionally do NOT emit the current clipboard on startup —
                // like the other platforms, we only report changes.
                Application.Run(new ApplicationContext());
                GC.KeepAlive(watcher);
            }
        }

        /// <summary>
        /// Read the current clipboard and print it as one JSON line. Every
        /// clipboard call is guarded: a transiently-locked clipboard must never
        /// crash the watcher.
        /// </summary>
        internal static void EmitClipboard()
        {
            try
            {
                var items = new List<string[]>();

                // Files first: an Explorer file copy is a CF_HDROP drop list. The
                // client (index.mjs) turns a text/uri-list entry into shipped file
                // bytes, so we only ever surface the first file's file:// URL.
                try
                {
                    if (Clipboard.ContainsFileDropList())
                    {
                        var files = Clipboard.GetFileDropList();
                        if (files.Count > 0 && !string.IsNullOrEmpty(files[0]))
                        {
                            var uri = new Uri(files[0]).AbsoluteUri;
                            items.Add(new[] { "text/uri-list", B64(Encoding.UTF8.GetBytes(uri)) });
                        }
                    }
                }
                catch (Exception e)
                {
                    Console.Error.WriteLine("file read error: " + e.Message);
                }

                var png = TryReadPng();
                if (png != null) items.Add(new[] { "image/png", png });

                try
                {
                    if (Clipboard.ContainsText())
                    {
                        var text = Clipboard.GetText();
                        if (!string.IsNullOrEmpty(text))
                        {
                            items.Add(new[] { "text/plain", B64(Encoding.UTF8.GetBytes(text)) });
                        }
                    }
                }
                catch (Exception e)
                {
                    Console.Error.WriteLine("text read error: " + e.Message);
                }

                if (items.Count == 0) return;

                Console.Out.WriteLine(JsonSerializer.Serialize(items));
                Console.Out.Flush();
            }
            catch (Exception e)
            {
                Console.Error.WriteLine("read error: " + e.Message);
            }
        }

        private static string TryReadPng()
        {
            try
            {
                // Prefer a real PNG (preserves transparency) if an app provided one.
                if (Clipboard.ContainsData("PNG"))
                {
                    var data = Clipboard.GetData("PNG");
                    if (data is MemoryStream ms) return B64(ms.ToArray());
                    if (data is byte[] bytes) return B64(bytes);
                }

                // Fall back to re-encoding whatever bitmap is on the clipboard.
                if (Clipboard.ContainsImage())
                {
                    using (var img = Clipboard.GetImage())
                    {
                        if (img != null)
                        {
                            using (var buf = new MemoryStream())
                            {
                                img.Save(buf, ImageFormat.Png);
                                return B64(buf.ToArray());
                            }
                        }
                    }
                }
            }
            catch (Exception e)
            {
                Console.Error.WriteLine("png read error: " + e.Message);
            }

            return null;
        }

        // ----- writer (--set) ----------------------------------------------

        private static void SetClipboard()
        {
            var line = Console.In.ReadLine();
            if (string.IsNullOrEmpty(line))
            {
                Console.Error.WriteLine("No input provided.");
                return;
            }

            List<List<string>> items;
            try
            {
                items = JsonSerializer.Deserialize<List<List<string>>>(line);
            }
            catch (Exception e)
            {
                Console.Error.WriteLine("parse error: " + e.Message);
                return;
            }

            if (items == null) return;

            var data = new DataObject();
            var files = new StringCollection();
            var any = false;

            foreach (var item in items)
            {
                if (item == null || item.Count != 2) continue;
                var mime = item[0];
                byte[] bytes;
                try
                {
                    bytes = Convert.FromBase64String(item[1]);
                }
                catch
                {
                    Console.Error.WriteLine("bad base64 for " + mime);
                    continue;
                }

                switch (mime)
                {
                    case "text/plain":
                        data.SetText(Encoding.UTF8.GetString(bytes));
                        any = true;
                        break;

                    case "image/png":
                        // Provide both the raw PNG (transparency-preserving) and a
                        // decoded Bitmap so DIB-only consumers still work.
                        data.SetData("PNG", new MemoryStream(bytes));
                        try
                        {
                            var bmp = new Bitmap(new MemoryStream(bytes));
                            data.SetImage(bmp);
                        }
                        catch (Exception e)
                        {
                            Console.Error.WriteLine("png decode error: " + e.Message);
                        }
                        any = true;
                        break;

                    case "text/uri-list":
                        try
                        {
                            var localPath = new Uri(Encoding.UTF8.GetString(bytes)).LocalPath;
                            files.Add(localPath);
                        }
                        catch (Exception e)
                        {
                            Console.Error.WriteLine("uri parse error: " + e.Message);
                        }
                        break;

                    default:
                        // Unknown MIME type (e.g. special-clipboard-share/file is
                        // resolved to text/uri-list by the client before we see it).
                        break;
                }
            }

            if (files.Count > 0)
            {
                data.SetFileDropList(files);
                any = true;
            }

            if (!any)
            {
                Console.Error.WriteLine("Nothing to set.");
                return;
            }

            try
            {
                // copy: true flushes to the OLE clipboard so the data survives this
                // short-lived process exiting. Retry a few times if it is locked.
                Clipboard.SetDataObject(data, true, 10, 100);
            }
            catch (Exception e)
            {
                Console.Error.WriteLine("set error: " + e.Message);
            }
        }

        private static string B64(byte[] bytes) => Convert.ToBase64String(bytes);

        // ----- clipboard change listener -----------------------------------

        /// <summary>
        /// A message-only window that receives WM_CLIPBOARDUPDATE via
        /// AddClipboardFormatListener — event-driven, no polling.
        /// </summary>
        private sealed class ClipboardWatcher : NativeWindow, IDisposable
        {
            private const int WM_CLIPBOARDUPDATE = 0x031D;
            private static readonly IntPtr HWND_MESSAGE = new IntPtr(-3);

            [DllImport("user32.dll", SetLastError = true)]
            private static extern bool AddClipboardFormatListener(IntPtr hwnd);

            [DllImport("user32.dll", SetLastError = true)]
            private static extern bool RemoveClipboardFormatListener(IntPtr hwnd);

            public ClipboardWatcher()
            {
                CreateHandle(new CreateParams { Parent = HWND_MESSAGE });
                AddClipboardFormatListener(Handle);
            }

            protected override void WndProc(ref Message m)
            {
                if (m.Msg == WM_CLIPBOARDUPDATE)
                {
                    EmitClipboard();
                }

                base.WndProc(ref m);
            }

            public void Dispose()
            {
                if (Handle != IntPtr.Zero)
                {
                    RemoveClipboardFormatListener(Handle);
                    DestroyHandle();
                }
            }
        }
    }
}
