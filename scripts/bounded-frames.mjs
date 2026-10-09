// Retain fragments once and scan only newly received bytes. Concatenate only
// when a complete newline-delimited frame is available.
export class BoundedFrames {
 constructor(maximum) { this.maximum=maximum;this.parts=[];this.bytes=0; }
 push(chunk) {
  const frames=[];let offset=0;
  while(offset<chunk.length){
   const newline=chunk.indexOf(10,offset),end=newline<0?chunk.length:newline;
   const length=end-offset;if(length>this.maximum-this.bytes)throw Error('Slider frame is too large.');
   if(length){this.parts.push(chunk.subarray(offset,end));this.bytes+=length;}
   if(newline<0)break;
   frames.push(Buffer.concat(this.parts,this.bytes));this.parts=[];this.bytes=0;offset=newline+1;
  }
  return frames;
 }
}
