const TARGETS = new Set(['es','pt','en']);

async function googleTranslate(text,target){
  if(!text) return '';
  const url=new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client','gtx');
  url.searchParams.set('sl','auto');
  url.searchParams.set('tl',target);
  url.searchParams.set('dt','t');
  url.searchParams.set('q',text);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const res=await fetch(url,{signal:controller.signal,headers:{'User-Agent':'LINK-Translate/1.0'}});
    if(!res.ok) throw new Error('translation upstream '+res.status);
    const data=await res.json();
    return Array.isArray(data?.[0]) ? data[0].map(x=>x?.[0]||'').join('').trim() : text;
  }finally{clearTimeout(timer);}
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido.'});
  const body=req.body||{};
  const texts=Array.isArray(body.texts)?body.texts.map(x=>String(x??'')).slice(0,60):null;
  const single=typeof body.text==='string'?body.text:null;
  const targets=(Array.isArray(body.targets)?body.targets:[body.targetLanguage||'es']).filter(t=>TARGETS.has(t));

  if((!texts||!texts.length)&&!single) return res.status(400).json({error:'Falta texto para traducir.'});
  if(!targets.length) return res.status(400).json({error:'Idioma de destino no soportado.'});

  try{
    if(single){
      if(single.length>4000) return res.status(400).json({error:'Texto demasiado largo.'});
      const translation=await googleTranslate(single,targets[0]);
      return res.status(200).json({translation});
    }

    const safeTexts=texts.map(t=>t.slice(0,4000));
    const translations={};
    for(const target of targets){
      translations[target]=[];
      for(const text of safeTexts){
        translations[target].push(await googleTranslate(text,target));
      }
    }
    return res.status(200).json({translations});
  }catch(error){
    console.error('translate',error);
    const timed=error?.name==='AbortError';
    return res.status(timed?504:502).json({error:timed?'La traducción tardó demasiado.':'El servicio de traducción no respondió.'});
  }
}
