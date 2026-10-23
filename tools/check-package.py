#!/usr/bin/env python3
"""Check archive contents and test the JavaScript actually bundled in the VSIX."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
dist = root / 'dist'
package = json.loads((root / 'package.json').read_text())
vsix = dist / (package['name'] + '-' + package['version'] + '.vsix')
with tempfile.TemporaryDirectory(prefix='snapshot-packaged-') as tmp:
    work = Path(tmp)
    with ZipFile(vsix) as z:
        assert z.testzip() is None
        ET.fromstring(z.read('extension.vsixmanifest'))
        ET.fromstring(z.read('[Content_Types].xml'))
        for name in ['package.json', 'extension.js', 'recorder.js', 'README.md', 'LICENSE']:
            data = z.read('extension/' + name)
            assert data == (root / name).read_bytes(), f'Stale bundled file: {name}'
            (work / name).write_bytes(data)
    shutil.copytree(root / 'test', work / 'test')
    subprocess.run(['node', '--check', str(work / 'extension.js')], check=True)
    subprocess.run(['node', '--check', str(work / 'recorder.js')], check=True)
    subprocess.run(['node', '--test', '--test-isolation=none', *map(str, sorted((work / 'test').glob('*.test.js')))], cwd=work, check=True)
    with ZipFile(dist / 'code-snapshots-school-kit.zip') as z:
        assert z.testzip() is None
        assert z.read(vsix.name) == vsix.read_bytes()
        for name in ['QUICKSTART.txt', 'README.md', 'LICENSE']:
            assert z.read(name) == (root / name).read_bytes()
        for name in ['recorder.js', 'tools/verify-session.js']:
            assert z.read('verification/' + name) == (root / name).read_bytes()
    for line in (dist / 'SHA256SUMS.txt').read_text().splitlines():
        expected, name = line.split('  ', 1)
        assert hashlib.sha256((dist / name).read_bytes()).hexdigest() == expected
print('PASS: packaged runtime tests, VSIX/ZIP contents, XML, source parity and SHA256 checksums')
