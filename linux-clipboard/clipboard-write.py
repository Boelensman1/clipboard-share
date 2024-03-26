#!/usr/bin/env python3
import gi
import sys
import os
import json
import base64
gi.require_version("Gdk", "4.0")
gi.require_version('Gtk', '4.0')
from gi.repository import Gtk, Gdk, GLib, Gio

def copy_file_to_clipboard(file_path):
    # Create a Gio.File object from the file path

    # Get the default clipboard
    clipboard = Gtk.Clipboard.get_default()

    # Create a Gtk.ContentProvider for the file
    content_provider = Gtk.ContentProvider.new_for_value(gio_file)

    # Set the content of the clipboard to the file
    clipboard.set_content(content_provider)

    # To also include the filename as text, we can add it separately
    filename = gio_file.get_basename()
    clipboard.set_text(filename)

def set_clipboard_content(data):
    # Parse the input JSON data
    try:
        parsed_data = json.loads(data)
    except json.JSONDecodeError:
        print("Failed to decode JSON. Ensure input is a valid JSON string.", file=sys.stderr)
        return

    # Assuming Gdk.Display.get_clipboard() is set to handle multiple contents,
    # we'll proceed with the first item in the parsed data for this example.
    # This can be expanded to handle multiple items differently.
    if not parsed_data or not isinstance(parsed_data, list):
        print("Input data is not in the expected format.", file=sys.stderr)
        return

    content_providers = []
    for item in parsed_data:
        if len(item) != 2:
            print("Skipping invalid item, each item must have 2 elements: mimetype and base64encoded content.")
            continue

        mime_type, base64_content = item
        try:
            decoded_content = base64.b64decode(base64_content)
        except Exception as e:
            print(f"Failed to decode base64 content: {e}")
            continue

        # let gdk handle the mime types
        if mime_type == 'text/plain':
            content_provider = Gdk.ContentProvider.new_for_value(decoded_content.decode('utf-8'))
        else:
            # probably png/file, set the mime_type manually
            data_bytes = GLib.Bytes.new(decoded_content)
            content_provider = Gdk.ContentProvider.new_for_bytes(mime_type, data_bytes)

        content_providers.append(content_provider)

    if not content_providers:
        print("No valid content to set on the clipboard.")
        return

    clipboard = Gdk.Display.get_clipboard(Gdk.Display.get_default())
    union_content_provider = Gdk.ContentProvider.new_union(content_providers)
    clipboard.set_content(union_content_provider)

    print("Content has been set to the clipboard.")


def on_stdin_available(source, condition):
    # Read a line from stdin
    line = sys.stdin.readline()
    if not line:
        # End of input, stop the loop
        loop.quit()
        return False
    # Strip newline and set clipboard content
    set_clipboard_content(line.rstrip("\n"))
    return True  # Keep the callback active

# Create a GLib main loop
loop = GLib.MainLoop()

# Add a watch on stdin to call on_stdin_available when input is available
GLib.io_add_watch(sys.stdin, GLib.IO_IN, on_stdin_available)

try:
    # Start the main loop to keep the application running
    loop.run()
except KeyboardInterrupt:
    # Allow the application to be closed with Ctrl+C
    loop.quit()
