#!/usr/bin/env swift
import Cocoa
import Foundation

let newline = Data([0x0A] as [UInt8])

let types: [NSPasteboard.PasteboardType] = [.fileURL, .png, .string]

let mimeTypeToPasteboardType: [String: NSPasteboard.PasteboardType] = [
    "text/plain": .string,
    "text/html": .html,
    "image/png": .png,
    "text/uri-list": .fileURL,
]

let pasteboardTypeToMimeType = Dictionary(uniqueKeysWithValues: mimeTypeToPasteboardType.map { ($1.rawValue, $0) })

// Convert MIME type to NSPasteboard.PasteboardType
func pasteboardType(forMIMEType mimeType: String) -> NSPasteboard.PasteboardType? {
    mimeTypeToPasteboardType[mimeType]
}

// Convert NSPasteboard.PasteboardType to MIME type
func mimeType(forPasteboardType pasteboardType: NSPasteboard.PasteboardType) -> String? {
    pasteboardTypeToMimeType[pasteboardType.rawValue]
}

/**
 Write the given string to STDERR.

 - parameter str: native string to write encode in utf-8.
 - parameter appendNewline: whether or not to write a newline (U+000A) after the given string (defaults to true)
 */
func printErr(_ str: String, appendNewline: Bool = true) {
    // writing to STDERR takes a bit of boilerplate, compared to print()
    if let data = str.data(using: .utf8) {
        FileHandle.standardError.write(data)
        if appendNewline {
            FileHandle.standardError.write(newline)
        }
    }
}

/**
 Read Data from NSPasteboard.

 - parameter pasteboard: specific pasteboard to read from
 - parameter dataType: pasteboard data type to read as

 - throws: `NSError` if data cannot be read as given dataType
 - returns: Tuple containing `Data` and the data type as `String`
 */
func pasteboardData(_ pasteboard: NSPasteboard, dataType: NSPasteboard.PasteboardType) throws -> Data {
    if let string = pasteboard.string(forType: dataType) {
        let data = string.data(using: .utf8)! // supposedly force-unwrapping using UTF-8 never fails
        return data
    }
    if let data = pasteboard.data(forType: dataType) {
        return data
    }
    throw NSError(
        domain: "pbv",
        code: 0,
        userInfo: [
            NSLocalizedDescriptionKey: "Could not access pasteboard contents as '\(dataType)'",
        ]
    )
}

/**
 Read Data from NSPasteboard, trying each dataType in turn.

 - parameter pasteboard: specific pasteboard to read from
 - parameter dataTypeNames: names of pasteboard data type to try reading as

 - throws: `NSError` if data cannot be read as _any_ of the given dataTypes
 - returns: A tuple containing the data and the data type name as a String
 */
func bestPasteboardData(_ pasteboard: NSPasteboard) throws -> (data: Data, type: NSPasteboard.PasteboardType) {
    for dataType in types {
        if let data = try? pasteboardData(pasteboard, dataType: dataType) {
            return (data, dataType)
        }
    }
    let typeNamesJoined = types.map { "'\($0)'" }.joined(separator: ", ")

    throw NSError(
        domain: "pbv",
        code: 0,
        userInfo: [
            NSLocalizedDescriptionKey: "Could not access pasteboard contents for types: \(typeNamesJoined)",
        ]
    )
}

func streamBestPasteboardData(_ pasteboard: NSPasteboard, timeInterval: TimeInterval = 0.1) -> Timer {
    var lastChangeCount = pasteboard.changeCount

    return Timer.scheduledTimer(withTimeInterval: timeInterval, repeats: true) { _ in
        let changeCount = pasteboard.changeCount
        if changeCount != lastChangeCount {
            lastChangeCount = changeCount
            var allDataFormats = [[String]]()

            guard let types = pasteboard.types else {
                printErr("No pasteboard types available.")
                return
            }

            for dataType in types {
                guard let data = pasteboard.data(forType: dataType),
                      let mimeType = mimeType(forPasteboardType: dataType) else { continue }

                var dataToEncode = data

                // Resolve file reference URLs to actual filesystem paths
                if dataType == .fileURL,
                   let urlString = String(data: data, encoding: .utf8),
                   let fileURL = URL(string: urlString) {
                    let standardizedURL = fileURL.standardized
                    dataToEncode = standardizedURL.absoluteString.data(using: .utf8) ?? data
                }

                let dataString = dataToEncode.base64EncodedString()
                allDataFormats.append([mimeType, dataString])
            }
            do {
                let jsonData = try JSONSerialization.data(withJSONObject: allDataFormats)
                if let jsonString = String(data: jsonData, encoding: .utf8) {
                    print(jsonString)
                    fflush(stdout) // flush output
                }
            } catch {
                printErr(error.localizedDescription)
            }
        }
    }
}

func applyPasteboardData(_ pasteboard: NSPasteboard) {
    guard let line = readLine(), !line.isEmpty else {
        printErr("No input provided. Exiting.")
        exit(0)
    }

    guard let inputData = line.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: inputData) as? [[Any]]
    else {
        printErr("Failed to parse input. Ensure it's valid JSON with the correct structure.")
        return
    }

    pasteboard.clearContents()
    var items = [NSPasteboardItem]()

    for jsonArray in json {
        guard jsonArray.count == 2,
              let dataTypeName = jsonArray[0] as? String,
              let dataString = jsonArray[1] as? String,
              let data = Data(base64Encoded: dataString),
              let dataType = pasteboardType(forMIMEType: dataTypeName)
        else {
            printErr("Input parsing failed. Check that your JSON is correctly structured.")
            return
        }

        let pasteboardItem = NSPasteboardItem()

        if dataType == NSPasteboard.PasteboardType.fileURL {
            if let fileURLString = String(data: data, encoding: .utf8),
               let fileURL = URL(string: fileURLString)
            {
                // Verify the file URL points to an existing file
                var isDir: ObjCBool = false
                if FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDir), !isDir.boolValue {
                    print("File exists!")
                    print(fileURL.absoluteString)
                    pasteboardItem.setString(fileURL.absoluteString, forType: .fileURL)
                    items.append(pasteboardItem)
                } else {
                    print(fileURL.path)
                    printErr("The specified file does not exist at the provided URL.")
                }
            } else {
                printErr("Failed to decode file URL from base64 string.")
            }
        } else {
            pasteboardItem.setData(data, forType: dataType)
            items.append(pasteboardItem)
        }
    }

    if pasteboard.writeObjects(items) {
        print("Clipboard successfully updated with multiple MIME types.")
    } else {
        printErr("Error: Clipboard update failed with multiple MIME types.")
    }
}

func printTypes(_ pasteboard: NSPasteboard) {
    printErr("Available types for the '\(pasteboard.name.rawValue)' pasteboard:")
    // Apple documentation says `types` "is an array NSString objects",
    // but that's wrong: they are PasteboardType structures.
    if let types = pasteboard.types {
        for type in types {
            printErr("  \(type.rawValue)")
        }
    } else {
        printErr("  (not available)")
    }
}

// CLI entry point
func main() {
    let pasteboard: NSPasteboard = .general

    // CommandLine.arguments[0] is the fullpath to this file
    // CommandLine.arguments[1+] should be the desired type(s)
    let args = Array(CommandLine.arguments.dropFirst())
    if args.contains("-h") || args.contains("--help") {
        printTypes(pasteboard)
        exit(0)
    }

    if args.contains("-p") || args.contains("--paste") {
        applyPasteboardData(pasteboard)
        exit(0)
    }

    if args.contains("-s") || args.contains("--stream") {
        let timer = streamBestPasteboardData(pasteboard)

        let runLoop = RunLoop.main
        runLoop.add(timer, forMode: .default)
        runLoop.run()
    } else {
        do {
            let (data, dataType) = try bestPasteboardData(pasteboard)
            print(dataType)
            FileHandle.standardOutput.write(data)
            exit(0)
        } catch {
            printErr(error.localizedDescription)
            printTypes(pasteboard)
            exit(1)
        }
    }
}

main()
