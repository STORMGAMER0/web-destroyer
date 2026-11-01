# Extract chosen sounds from a MUGEN .snd file and pack them, as MP3s, into one file.
# usage: snd_extract.py <file.snd> <sounds.json> <out_dir>
#   sounds.json maps a name the engine uses to "group,sample", e.g. {"jump": "40,3"}
# Writes <out_dir>/sounds.bin (the MP3s back to back) and <out_dir>/sounds.json
# ({name: [offset, length]}). One plain data file instead of loose .mp3s means a single
# request, and download managers (e.g. IDM) don't grab the clips as they load.
# Needs ffmpeg on PATH.
import json, os, struct, subprocess, sys, tempfile

snd_path, names_path, out_dir = sys.argv[1:4]
names = json.load(open(names_path))
data = open(snd_path, 'rb').read()
if not data.startswith(b'ElecbyteSnd'):
    sys.exit('not a MUGEN .snd file')

# Index every sound: (group, sample) -> raw WAV bytes
count, offset = struct.unpack('<II', data[16:24])
sounds = {}
for _ in range(count):
    nxt, length, group, sample = struct.unpack('<IIII', data[offset:offset + 16])
    sounds[(group, sample)] = data[offset + 16:offset + 16 + length]
    offset = nxt
    if not offset:
        break

os.makedirs(out_dir, exist_ok=True)
manifest = {}
pack = bytearray()
with tempfile.TemporaryDirectory() as tmp:
    for name, key in names.items():
        group, sample = map(int, key.split(','))
        wav = sounds.get((group, sample))
        if wav is None:
            print(f'missing {name} ({key})')
            continue
        src = os.path.join(tmp, f'{group}_{sample}.wav')
        open(src, 'wb').write(wav)
        mp3 = os.path.join(tmp, f'{group}_{sample}.mp3')
        # Mono, 64 kbps: plenty for short game sounds
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-ac', '1', '-b:a', '64k', mp3], check=True)
        data_mp3 = open(mp3, 'rb').read()
        manifest[name] = [len(pack), len(data_mp3)]
        pack += data_mp3
        print(f'{name:22} {key:>7}  {len(data_mp3) // 1024:3} KB')

open(os.path.join(out_dir, 'sounds.bin'), 'wb').write(pack)
json.dump(manifest, open(os.path.join(out_dir, 'sounds.json'), 'w'), indent=1)
print(f'{len(manifest)} sounds, {len(pack) // 1024} KB total')
