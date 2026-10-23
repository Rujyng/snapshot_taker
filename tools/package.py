#!/usr/bin/env python3
"""Build a standard VSIX and a school transfer ZIP without external dependencies."""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)
package = json.loads((ROOT / "package.json").read_text())
name = package["name"] + "-" + package["version"]

manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
 <Metadata>
  <Identity Language="en-US" Id="{package['name']}" Version="{package['version']}" Publisher="{package['publisher']}"/>
  <DisplayName>{package['displayName']}</DisplayName>
  <Description xml:space="preserve">{package['description']}</Description>
  <Tags>research,snapshots,offline</Tags><Categories>Other</Categories>
  <Properties>
   <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{package['engines']['vscode']}"/>
   <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>
   <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
   <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace"/>
  </Properties>
  <License>extension/LICENSE</License>
 </Metadata>
 <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
 <Dependencies/>
 <Assets>
  <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
  <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
  <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/>
 </Assets>
</PackageManifest>
'''
content_types = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="json" ContentType="application/json"/>
 <Default Extension="js" ContentType="application/javascript"/>
 <Default Extension="md" ContentType="text/markdown"/>
 <Default Extension="txt" ContentType="text/plain"/>
 <Default Extension="vsixmanifest" ContentType="text/xml"/>
 <Override PartName="/extension/LICENSE" ContentType="text/plain"/>
</Types>
'''
ET.fromstring(manifest)
ET.fromstring(content_types)
vsix = DIST / (name + ".vsix")
with ZipFile(vsix, "w", ZIP_DEFLATED) as z:
    z.writestr("extension.vsixmanifest", manifest)
    z.writestr("[Content_Types].xml", content_types)
    for file in ["package.json", "extension.js", "recorder.js", "README.md", "LICENSE"]:
        z.write(ROOT / file, "extension/" + file)
with ZipFile(vsix) as z:
    assert z.testzip() is None
    for file in ["package.json", "extension.js", "recorder.js", "README.md", "LICENSE"]:
        assert z.read("extension/" + file) == (ROOT / file).read_bytes()
    parsed = json.loads(z.read("extension/package.json"))
    assert parsed["main"] == "./extension.js"
transfer = DIST / "code-snapshots-school-kit.zip"
with ZipFile(transfer, "w", ZIP_DEFLATED) as z:
    z.write(vsix, vsix.name)
    for file in ["QUICKSTART.txt", "README.md", "LICENSE"]:
        z.write(ROOT / file, file)
    for file in ["recorder.js", "tools/verify-session.js"]:
        z.write(ROOT / file, "verification/" + file)
checksums = []
for file in [vsix, transfer]:
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    checksums.append(digest + "  " + file.name)
    print(f"{file.name}: {file.stat().st_size:,} bytes; SHA256 {digest}")
(DIST / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n")
