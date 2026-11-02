# Build trimmed web sprite atlas from extracted SFF sprites + AIR animations.
# usage: build_atlas.py <char_dir> <sff_out_dir> <keep.json> <out_dir>
# keep.json: {"air": "<file>.air", "pixel": [names kept lossless], "anims": {name: spec}}
#   spec = AIR action number, or {"anim": n, "bake": explod scale the game draws it at,
#          "decimate": keep every Nth frame, "timescale": multiply frame times, "loop": true,
#          "first": true to use the first of several actions with the same number (default: last),
#          "add": true for an effect the character blends additively in code (Trans = add) though
#          its AIR frames aren't marked so}
import json,re,sys,os,io
from PIL import Image,ImageChops,ImageMath
char,src,keepf,out=sys.argv[1:5]
cfg=json.load(open(keepf))
specs={name:(v if isinstance(v,dict) else {'anim':v}) for name,v in cfg['anims'].items()}
PIXEL=set(cfg.get('pixel',[]))
MAX=2048;PAD=2
air={};first={};cur=None
for line in open(os.path.join(char,cfg['air']),encoding='latin-1'):
    l=line.split(';')[0].strip()
    m=re.match(r'\[\s*begin\s+action\s+(-?\d+)\s*\]',l,re.I)
    if m:
        cur=int(m.group(1)); air[cur]=[]
        if cur not in first: first[cur]=air[cur]
        continue
    p=[x.strip() for x in l.split(',')]
    if cur is not None and len(p)>=5 and all(re.match(r'-?\d+$',x) for x in p[:5]):
        air[cur].append(dict(g=int(p[0]),i=int(p[1]),x=int(p[2]),y=int(p[3]),t=int(p[4]),
                             flip=(p[5] if len(p)>5 else '').upper(),add=len(p)>6 and p[6].upper().startswith('A')))
idx=json.load(open(os.path.join(src,'_index.json')))
sprites={};anims={}
def additive_to_alpha(im):
    # MUGEN adds these onto the screen (black = nothing). Our canvas floats over the page with
    # nothing to add to, so turn brightness into opacity: alpha = max(r,g,b), colour un-premultiplied.
    r,g,b,a0=im.split()
    a=ImageChops.multiply(ImageChops.lighter(r,ImageChops.lighter(g,b)),a0)
    un=lambda c: ImageMath.lambda_eval(lambda e: e['c']*255/e['max'](e['a'],1),c=c,a=a).convert('L')
    a=a.point(lambda v: 0 if v<=8 else v)
    return Image.merge('RGBA',(un(r),un(g),un(b),a))
def load(key,scale,add):
    sk=f'{key}@{scale}'
    if sk in sprites: return sk
    im=Image.open(os.path.join(src,key+'.png')).convert('RGBA')
    if add: im=additive_to_alpha(im)
    bb=im.getbbox() or (0,0,1,1)
    im=im.crop(bb);ax=idx[key]['ax']-bb[0];ay=idx[key]['ay']-bb[1]
    if scale!=1:
        im=im.resize((max(1,round(im.width*scale)),max(1,round(im.height*scale))),Image.LANCZOS);ax*=scale;ay*=scale
    sprites[sk]={'img':im,'ax':round(ax),'ay':round(ay)}
    return sk
for name,spec in specs.items():
    a=spec['anim']
    fr=[f for f in (first if spec.get('first') else air)[a] if f['g']>=0 and f"{f['g']}_{f['i']}" in idx]
    n=spec.get('decimate',1)
    if n>1: fr=[dict(f,t=f['t']*n) for f in fr[::n]]
    ts=spec.get('timescale',1)
    if ts!=1: fr=[dict(f,t=max(1,round(f['t']*ts))) for f in fr]
    s=spec.get('bake',1);force=bool(spec.get('add'));add=force or any(f['add'] for f in fr)
    anims[name]={'loop':bool(spec.get('loop')),'blend':'add' if add else None,
        'frames':[{'s':load(f"{f['g']}_{f['i']}",s,f['add'] or force),'t':max(f['t'],1),'x':round(f['x']*s),'y':round(f['y']*s),'flip':f['flip']} for f in fr]}
# The character's own pixel-art frames stay lossless; big painted effects use lossy WebP (much smaller)
pixel_keys={f['s'] for n in PIXEL if n in anims for f in anims[n]['frames']}
# shelf pack, tallest first, into MAX x MAX sheets (pixel-art and effects packed separately)
sheets=[];lossless=[]
for group,is_pixel in ((pixel_keys,True),(set(sprites)-pixel_keys,False)):
    order=sorted(group,key=lambda k:(-sprites[k]['img'].height,k))  # fixed order: same input, same sheets
    first=True;x=y=rowh=0
    for k in order:
        im=sprites[k]['img'];w,h=im.width+PAD,im.height+PAD
        if first or x+w>MAX: x=0;y+=rowh;rowh=0
        if first or y+h>MAX: sheets.append([]);lossless.append(is_pixel);x=y=rowh=0;first=False
        sprites[k].update(sheet=len(sheets)-1,x=x,y=y);sheets[-1].append(k);x+=w;rowh=max(rowh,h)
os.makedirs(out,exist_ok=True);files=[]
for n,keys in enumerate(sheets):
    W=max(sprites[k]['x']+sprites[k]['img'].width for k in keys);H=max(sprites[k]['y']+sprites[k]['img'].height for k in keys)
    can=Image.new('RGBA',(W,H))
    for k in keys: can.paste(sprites[k]['img'],(sprites[k]['x'],sprites[k]['y']))
    fn=f'sheet{n}.webp'
    can.save(os.path.join(out,fn),lossless=True,method=6)
    if not lossless[n]:  # effects: use lossy only when it actually comes out smaller
        buf=io.BytesIO();can.save(buf,'WEBP',quality=88,alpha_quality=90,method=6)
        if buf.tell()<os.path.getsize(os.path.join(out,fn)): open(os.path.join(out,fn),'wb').write(buf.getvalue())
    files.append(fn)
    print(fn,W,H,os.path.getsize(os.path.join(out,fn))//1024,'KB')
data={'sheets':files,
      'sprites':{k:{'sheet':v['sheet'],'x':v['x'],'y':v['y'],'w':v['img'].width,'h':v['img'].height,'ax':v['ax'],'ay':v['ay']} for k,v in sprites.items()},
      'anims':anims}
json.dump(data,open(os.path.join(out,os.path.basename(os.path.normpath(out))+'.json'),'w'),separators=(',',':'))
print(len(sprites),'sprites',len(anims),'anims',os.path.getsize(os.path.join(out,os.path.basename(os.path.normpath(out))+'.json'))//1024,'KB json')
