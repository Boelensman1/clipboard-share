#!/usr/bin/env python3
import gi
import sys
import base64
import json
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, Gdk


formats = ["image/png", "text/uri-list", "text/plain", "UTF8_STRING"]

def get_format(input_string):
    # Mapping of input formats to their desired output
    format_map = {
        "UTF8_STRING": "text/plain",
    }

    # Return the corresponding format if found, else the input
    return format_map.get(input_string, input_string)

# Function to try to get content in preferred format
def clipboard_changed(clipboard, event):
    success, targets = clipboard.wait_for_targets()
    if targets is None:
        print("No targets available.", file=sys.stderr)
    else:
        target_names = [target.name() for target in targets]  # Get the name of each Gdk.Atom

        # Use a dictionary to avoid duplicate formats
        clipboard_dict = {}
        for preferred_format in formats:
            if preferred_format in target_names:
                content = clipboard.wait_for_contents(Gdk.atom_intern(preferred_format, False))
                if content:
                    data = content.get_data()
                    encoded_data = base64.b64encode(data).decode('utf-8')
                    clipboard_dict[get_format(preferred_format)] = encoded_data

        clipboard_list = [[format, data] for format, data in clipboard_dict.items()]
        if len(clipboard_list) > 0:
            output = json.dumps(clipboard_list)
            print(output)
            sys.stdout.flush()
            return
        print("No preferred format available.", target_names, file=sys.stderr)

clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
clipboard.connect("owner-change", clipboard_changed)

Gtk.main()
