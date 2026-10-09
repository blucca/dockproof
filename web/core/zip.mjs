// A dependency-free, UTF-8 ZIP writer using the STORE method.
// Claim packets are small text documents; each entry has its original bytes and CRC32.
const encoder = new TextEncoder();
const table = Array.from({length:256}, (_,n) => {
  let c=n; for(let k=0;k<8;k++) c=(c&1)?0xedb88320^(c>>>1):c>>>1; return c>>>0;
});
const crc32 = data => { let c=0xffffffff; for(const byte of data) c=table[(c^byte)&255]^(c>>>8); return (c^0xffffffff)>>>0; };
const header = (size, fields) => {
  const data = new Uint8Array(size); const view = new DataView(data.buffer);
  for(const [offset,value,width=2] of fields) width===4?view.setUint32(offset,value,true):view.setUint16(offset,value,true);
  return data;
};

export function zipFiles(files) {
  const local=[]; const central=[]; let offset=0; let directorySize=0;
  for(const file of files) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(file.name) || file.name.startsWith('/') || file.name.split('/').includes('..')) throw new Error('Use a relative packet filename.');
    const name=encoder.encode(file.name); const data=encoder.encode(file.content); const crc=crc32(data);
    const entry=header(30,[[0,0x04034b50,4],[4,20],[6,0x0800],[10,0],[12,0x5d21],[14,crc,4],[18,data.length,4],[22,data.length,4],[26,name.length]]);
    local.push(entry,name,data);
    const index=header(46,[[0,0x02014b50,4],[4,20],[6,20],[8,0x0800],[12,0],[14,0x5d21],[16,crc,4],[20,data.length,4],[24,data.length,4],[28,name.length],[42,offset,4]]);
    central.push(index,name); directorySize+=index.length+name.length; offset+=entry.length+name.length+data.length;
  }
  const end=header(22,[[0,0x06054b50,4],[8,files.length],[10,files.length],[12,directorySize,4],[16,offset,4]]);
  return new Blob([...local,...central,end],{type:'application/zip'});
}
