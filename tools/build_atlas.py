# Build trimmed web sprite atlas from extracted SFF sprites + AIR animations.
# usage: build.py <char_dir> <sff_out_dir> <keep.json> <out_dir>
import json,re,sys,os
from PIL import Image,ImageChops,ImageMath
char,src,keepf,out=sys.argv[1:5]
keep=json.load(open(keepf))
BAKE={351:.11,3254:.5,3260:.3,9018:.8,30555:.19}   # explod scale the game draws these at
DECIMATE={3254,9020}                                # 1-tick effects: keep every 2nd frame
LOOP={'idle','run','rs_spin','rs_core','rs_wind','tbb_ball','tbb_glow'}
MAX=2048;PAD=2
air={};cur=None
for line in open(os.path.join(char,'Naruto.air'),encoding='latin-1'):
    l=line.split(';')[0].strip()
    m=re.match(r'\[\s*begin\s+action\s+(-?\d+)\s*\]',l,re.I)
    if m: cur=int(m.group(1)); air[cur]=[]; continue
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
for name,a in keep.items():
    fr=[f for f in air[a] if f['g']>=0 and f"{f['g']}_{f['i']}" in idx]
    if a in DECIMATE: fr=[dict(f,t=f['t']*2) for f in fr[::2]]
    s=BAKE.get(a,1);add=any(f['add'] for f in fr)
    anims[name]={'loop':name in LOOP,'blend':'add' if add else None,
        'frames':[{'s':load(f"{f['g']}_{f['i']}",s,f['add']),'t':max(f['t'],1),'x':round(f['x']*s),'y':round(f['y']*s),'flip':f['flip']} for f in fr]}
# shelf pack, tallest first, into MAX x MAX sheets
order=sorted(sprites,key=lambda k:-sprites[k]['img'].height)
sheets=[];x=y=rowh=0
for k in order:
    im=sprites[k]['img'];w,h=im.width+PAD,im.height+PAD
    if not sheets or x+w>MAX: x=0;y+=rowh;rowh=0
    if not sheets or y+h>MAX: sheets.append([]);x=y=rowh=0
    sprites[k].update(sheet=len(sheets)-1,x=x,y=y);sheets[-1].append(k);x+=w;rowh=max(rowh,h)
os.makedirs(out,exist_ok=True);files=[]
for n,keys in enumerate(sheets):
    W=max(sprites[k]['x']+sprites[k]['img'].width for k in keys);H=max(sprites[k]['y']+sprites[k]['img'].height for k in keys)
    can=Image.new('RGBA',(W,H))
    for k in keys: can.paste(sprites[k]['img'],(sprites[k]['x'],sprites[k]['y']))
    fn=f'sheet{n}.webp';can.save(os.path.join(out,fn),lossless=True,method=6);files.append(fn)
    print(fn,W,H,os.path.getsize(os.path.join(out,fn))//1024,'KB')
data={'sheets':files,
      'sprites':{k:{'sheet':v['sheet'],'x':v['x'],'y':v['y'],'w':v['img'].width,'h':v['img'].height,'ax':v['ax'],'ay':v['ay']} for k,v in sprites.items()},
      'anims':anims}
json.dump(data,open(os.path.join(out,'naruto.json'),'w'),separators=(',',':'))
print(len(sprites),'sprites',len(anims),'anims',os.path.getsize(os.path.join(out,'naruto.json'))//1024,'KB json')
