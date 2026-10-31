# Extract all sprites from an SFF v1 file into PNGs + axis index (json)
import struct,sys,io,json,os
from PIL import Image
sff,act,out=sys.argv[1],sys.argv[2],sys.argv[3]
data=open(sff,'rb').read()
ngroups,nimages,off,subsize=struct.unpack('<IIII',data[16:32])
a=open(act,'rb').read()[:768]
actpal=[]
for i in range(256):  # .act stored in reverse order
    j=255-i; actpal+= list(a[j*3:j*3+3])
def decode_pcx(p,samepal):
    bpp=p[3]; x0,y0,x1,y1=struct.unpack('<HHHH',p[4:12]); planes=p[65]; bpl=struct.unpack('<H',p[66:68])[0]
    w,h=x1-x0+1,y1-y0+1; need=bpl*planes*h; out=bytearray(); i=128
    while len(out)<need and i<len(p):
        c=p[i]; i+=1
        if c>=0xC0: out+=bytes([p[i]])*(c&0x3F); i+=1
        else: out.append(c)
    out=bytes(out[:need]).ljust(need,b'\x00')
    if bpp==8 and planes==1:
        img=Image.frombytes('P',(w,h),b''.join(out[y*bpl:y*bpl+w] for y in range(h)))
        if not samepal and len(p)>=769 and p[-769]==12: img.putpalette(p[-768:])
        else: img.putpalette(actpal)
        return img
    rows=[]
    for y in range(h):
        r=out[y*bpl*planes:(y+1)*bpl*planes]
        rows.append(bytes(v for x in range(w) for v in (r[x],r[bpl+x],r[2*bpl+x])))
    return Image.frombytes('RGB',(w,h),b''.join(rows))
sprites=[];last_pal=None;index={}
for n in range(nimages):
    nxt,length,ax,ay,g,im,link,samepal=struct.unpack('<IIhhHHHB',data[off:off+19])
    if length==0:
        src=sprites[link]; img=src['img']
    else:
        pcx=data[off+32:off+32+length]
        img=decode_pcx(pcx,samepal)
        if img.mode=='P':
            if samepal and last_pal is not None: img.putpalette(last_pal)
            else: last_pal=img.getpalette()
    sprites.append({'img':img})
    key=f'{g}_{im}'
    if key not in index:
        if img.mode=='P':
            rgba=img.convert('RGBA'); px=img.load(); w,h=img.size
            al=Image.new('L',img.size,255); ap=al.load()
            for y in range(h):
                for x in range(w):
                    if px[x,y]==0: ap[x,y]=0
            rgba.putalpha(al)
        else: rgba=img.convert('RGBA')
        rgba.save(os.path.join(out,f'{key}.png'))
        index[key]={'g':g,'i':im,'ax':ax,'ay':ay,'w':rgba.width,'h':rgba.height,'samepal':samepal,'linked':length==0}
    off=nxt
    if off==0: break
json.dump(index,open(os.path.join(out,'_index.json'),'w'))
print(nimages,len(index),len({v['g'] for v in index.values()}))
