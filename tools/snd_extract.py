# Extract chosen sounds from a MUGEN .snd file into small MP3s + a manifest for the engine.
# usage: snd_extract.py <file.snd> <sounds.json> <out_dir>
#   sounds.json maps a name the engine uses to "group,sample", e.g. {"jump": "40,3"}
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
total = 0
with tempfile.TemporaryDirectory() as tmp:
    for name, key in names.items():
        group, sample = map(int, key.split(','))
        wav = sounds.get((group, sample))
        if wav is None:
            print(f'missing {name} ({key})')
            continue
        src = os.path.join(tmp, f'{group}_{sample}.wav')
        open(src, 'wb').write(wav)
        dst = os.path.join(out_dir, f'{name}.mp3')
        # Mono, 64 kbps: plenty for short game sounds
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-ac', '1', '-b:a', '64k', dst], check=True)
        size = os.path.getsize(dst)
        total += size
        manifest[name] = f'{name}.mp3'
        print(f'{name:22} {key:>7}  {size // 1024:3} KB')

json.dump(manifest, open(os.path.join(out_dir, 'sounds.json'), 'w'), indent=1)
print(f'{len(manifest)} sounds, {total // 1024} KB total')
