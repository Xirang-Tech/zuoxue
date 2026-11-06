const products = [['keban','课伴','Pro'],['aiprd','AI PRD','个人专业档'],['aipm','AI PM 作品集','专业版'],['workflow','Vibe Workflow','专业版'],['pattern','产品范式','顾问 Pro']];
const text = (tag, value, className) => {
  const element = document.createElement(tag);
  if (value) element.textContent = value;
  if (className) element.className = className;
  return element;
};
const bannerStyles = `
:host{display:block;font:inherit;color:inherit;container-type:inline-size}
:host([hidden]){display:none}
*{box-sizing:border-box}
.card{position:relative;isolation:isolate;overflow:hidden;min-width:0;margin:24px 0;padding:32px 36px;border:1px solid #d9d2ff;border-radius:20px;background:linear-gradient(115deg,#faf8ff,#f1ecff 62%,#f9f6ff);color:#211c32}
.heading{position:relative;z-index:2;max-width:calc(100% - 280px)}
h2{margin:0;font-size:clamp(28px,4.6cqi,52px);font-weight:750;line-height:1.25;letter-spacing:-.035em;color:inherit}
.subtitle{margin:12px 0 0;font-size:clamp(14px,1.9cqi,20px);line-height:1.65;color:#655f76}
.products{position:relative;z-index:2;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;max-width:calc(100% - 270px);padding:0;margin:25px 0 0;list-style:none}
.product{display:flex;align-items:center;gap:9px;min-width:0;min-height:62px;padding:10px;border:1px solid #ddd5ff;border-radius:11px;background:#ffffffc9}
.logo{display:block;flex:0 0 32px;width:32px;height:32px;object-fit:contain}
.product-copy{display:flex;flex-direction:column;gap:4px;min-width:0}
.name{font-size:13px;font-weight:600;line-height:1.35;overflow-wrap:break-word}
.tier{font-size:12px;font-weight:400;line-height:1.35;color:#746b87}
.footer{position:relative;z-index:2;margin-top:23px}
.note{margin:0;color:#766c86;font-size:12px;line-height:1.8}
a{color:inherit;text-decoration:none}
.cta{position:absolute;right:36px;top:50%;z-index:3;display:inline-flex;align-items:center;justify-content:center;gap:16px;min-height:52px;padding:13px 23px;transform:translateY(-50%);border:1px solid #5433ff;border-radius:12px;background:#4e2bff;color:#fff;font-size:17px;font-weight:600;line-height:1.5;white-space:nowrap;transition:background .15s,box-shadow .15s}
.cta:hover{background:#3f20de;box-shadow:0 4px 14px #5131da25}
.cta:focus-visible,.link:focus-visible{outline:3px solid #7c5df0;outline-offset:4px}
.arrow{font-family:system-ui,sans-serif;font-size:20px;font-weight:400;line-height:1}
.art{position:absolute;z-index:0;pointer-events:none;object-fit:contain}
.theme-keban .art{top:18px;right:30%;width:200px;height:170px;mask-image:radial-gradient(ellipse,#000 40%,transparent 75%)}
.theme-keban .products{max-width:min(100%,840px)}
.theme-keban .footer{position:static}
.theme-aipm{padding:30px 34px;border-color:#b58aff;background:linear-gradient(112deg,#fff 8%,#f3edff 44%,#dfd0ff 76%);color:#301259}
.theme-aipm::before{position:absolute;inset:0 0 0 auto;z-index:0;width:25%;border-radius:55px 0 0 55px;background:linear-gradient(130deg,#7552c9,#39217e);content:''}
.theme-aipm .heading{max-width:72%}
.theme-aipm .art{top:24px;right:23%;width:30%;height:auto;aspect-ratio:395/317;opacity:.95}
.theme-aipm .products{grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;max-width:55%;margin-top:24px}
.theme-aipm .product{grid-column:span 2;min-height:54px;padding:8px 10px;border-color:#d7bfff;border-radius:10px;background:#fcfaffee}
.theme-aipm .product:nth-last-child(-n+2){grid-column:span 3}
.theme-aipm .cta{right:3%;min-width:19%;padding-inline:18px;border-color:#e5d8ff;background:linear-gradient(110deg,#fff,#e6d7ff);color:#301259}
.theme-aipm .cta:hover{background:#fff}
.theme-aipm .note{color:#71627f}
.theme-workflow{padding:30px;border:1px solid var(--color-line,#d5d4d1);border-radius:0;background:var(--color-paper,#fff);color:var(--color-ink,#171717)}
.theme-workflow .heading{max-width:82%}
.kicker{margin:0 0 16px;font:500 11px/1.4 system-ui,sans-serif;letter-spacing:.09em}
.theme-workflow h2{font-family:var(--font-serif,'Noto Serif SC','Songti SC',Georgia,serif);font-size:clamp(32px,4.3cqi,54px);font-weight:600;letter-spacing:-.03em}
.theme-workflow .subtitle{color:inherit;font-family:var(--font-serif,'Noto Serif SC','Songti SC',Georgia,serif);font-size:clamp(16px,2cqi,24px)}
.count{position:absolute;top:22px;right:32px;margin:0;font:italic 128px/.95 Georgia,'Times New Roman',serif;letter-spacing:-.08em;color:inherit}
.theme-workflow .products{max-width:none;gap:28px;margin-top:34px}
.theme-workflow .product{position:relative;justify-content:center;min-height:78px;padding:12px 10px;border:1px solid #999;border-radius:0;background:transparent}
.theme-workflow .product:not(:last-child)::after{position:absolute;left:100%;top:50%;width:29px;border-top:1px solid #999;content:''}
.theme-workflow .name{font-family:var(--font-serif,'Noto Serif SC','Songti SC',Georgia,serif);font-size:16px;font-weight:600}
.theme-workflow .tier{font-family:var(--font-serif,'Noto Serif SC','Songti SC',Georgia,serif);font-size:15px;color:#62615d}
.theme-workflow .footer{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:24px;padding-top:18px;border-top:1px solid #999}
.theme-workflow .note{font-family:var(--font-serif,'Noto Serif SC','Songti SC',Georgia,serif);font-size:15px;color:inherit}
.theme-workflow .cta{position:static;transform:none;min-height:46px;padding:10px 20px;border-color:#171717;border-radius:0;background:#151515;color:#fff;font-family:var(--font-serif,'Noto Serif SC','Songti SC',Georgia,serif);font-size:16px;font-weight:400}
.theme-workflow .cta:hover{background:#333;box-shadow:none}
.link{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;font-size:12px}
.link:hover{background:#8881}
@container(max-width:1050px){
 .theme-aipm .art{opacity:.55}
 .theme-aipm .name{font-size:12px}
 .theme-workflow .products{gap:16px}
 .theme-workflow .product:not(:last-child)::after{width:17px}
 .theme-workflow .product{padding:10px 8px;gap:8px}
 .theme-workflow .name{font-size:14px}
 .theme-workflow .tier{font-size:13px}
}
@container(max-width:900px){
 .theme-keban .products{max-width:none}
 .theme-keban .footer{display:flex;align-items:center;justify-content:space-between;gap:16px}
 .theme-keban .cta{position:static;transform:none;font-size:15px;min-height:46px}
 .theme-keban .art{right:7%;width:175px;height:150px;top:25px}
 .theme-keban .heading{max-width:calc(100% - 175px)}
}
@container(max-width:760px){
 .card{padding:24px;border-radius:16px}
 .heading,.theme-keban .heading,.theme-aipm .heading,.theme-workflow .heading{max-width:100%}
 h2{font-size:32px}
 .subtitle{font-size:15px}
 .products,.theme-aipm .products,.theme-workflow .products{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;max-width:none;margin-top:23px}
 .product,.theme-aipm .product,.theme-aipm .product:nth-last-child(-n+2){grid-column:auto;padding:12px;min-height:66px}
 .product:last-child{grid-column:1/-1}
 .theme-aipm .product:last-child{grid-column:1/-1}
 .name,.theme-aipm .name{font-size:14px}
 .tier{font-size:12px}
 .theme-keban .art{width:110px;height:100px;right:9px;top:20px;opacity:.22}
 .theme-keban .footer,.theme-workflow .footer{display:flex;align-items:stretch;flex-direction:column;gap:16px}
 .cta,.theme-aipm .cta,.theme-keban .cta,.theme-workflow .cta{position:static;transform:none;display:flex;width:100%;min-height:46px;margin-top:15px;font-size:15px}
 .theme-keban .cta,.theme-workflow .cta{margin-top:0}
 .note{font-size:12px}
 .theme-aipm::before{display:none}
 .theme-aipm .art{top:0;right:0;width:45%;height:160px;opacity:.18}
 .theme-aipm .cta{border-color:#5433ff;background:#4e2bff;color:#fff}
 .theme-aipm .cta:hover{background:#3f20de}
 .theme-workflow{border-radius:0}
 .theme-workflow .heading{padding-right:55px}
 .theme-workflow h2{font-size:32px}
 .theme-workflow .subtitle{font-size:16px}
 .count{top:29px;right:23px;font-size:66px}
 .theme-workflow .product{justify-content:flex-start}
 .theme-workflow .product::after{display:none}
 .theme-workflow .name{font-size:15px}
 .theme-workflow .tier{font-size:14px}
 .theme-workflow .note{font-size:13px}
}
@container(max-width:360px){
 .card{padding:20px 16px}
 h2,.theme-workflow h2{font-size:28px}
 .product,.theme-aipm .product{padding:10px 8px;gap:7px}
 .logo{flex-basis:28px;width:28px;height:28px}
 .name,.theme-aipm .name,.theme-workflow .name{font-size:12px}
 .tier,.theme-workflow .tier{font-size:12px}
 .theme-workflow .heading{padding-right:36px}
 .count{font-size:52px;right:17px}
}
@media(prefers-reduced-motion:reduce){.cta{transition:none}}
`;
function renderBanner(productId, catalog, link) {
  const card = text('section', '', `card theme-${productId}`);
  card.setAttribute('aria-label', '佐学联合大会员');
  const heading = text('header', '', 'heading');
  if (productId === 'workflow') heading.append(text('p', 'ZUOXUE MEMBERSHIP', 'kicker'));
  heading.append(text('h2','佐学联合大会员'), text('p','一次开通，畅享佐学旗下 5 款产品会员','subtitle'));
  card.append(heading);
  if (['keban', 'aipm'].includes(productId)) {
    const art = document.createElement('img');
    art.className = 'art'; art.alt = ''; art.src = `/union-media/${productId}-illustration.webp`;
    art.setAttribute('aria-hidden', 'true'); art.decoding = 'async';
    card.append(art);
  } else if (productId === 'workflow') {
    const count = text('p', '05', 'count'); count.setAttribute('aria-hidden', 'true'); card.append(count);
  }
  const list = text('ul', '', 'products');
  [...products].sort((a,b) => Number(b[0] === productId) - Number(a[0] === productId)).forEach(([id,name,tier]) => {
    const item = catalog?.products?.find(p => p.id === id);
    const row = text('li', '', 'product');
    const logo = document.createElement('img'); logo.src = `/union-media/${id}.svg`; logo.alt = ''; logo.width = 32; logo.height = 32; logo.className = 'logo'; logo.decoding = 'async';
    const copy = text('span', '', 'product-copy'); copy.append(text('strong',name,'name'), text('span',item?.tierName || tier,'tier'));
    row.append(logo, copy); list.append(row);
  });
  card.append(list);
  const footer = text('footer', '', 'footer');
  footer.append(text('p','各产品额度独立 · 原会员保留并顺延','note'));
  if (productId === 'workflow' || productId === 'keban') footer.append(link);
  else card.append(link);
  card.append(footer);
  return card;
}
export function mountUnionOffer(host, { productId, endpoint = '/api/union-membership', placement = 'paywall', returnUrl = location.href, fetcher = fetch, events = true }) {
  const controller = new AbortController();
  let visible = false;
  const shadow = host.shadowRoot || host.attachShadow({mode:'open'});
  const send = (name, context = {}) => { if (events) void fetcher(`${endpoint}/events`,{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({name,context:{entry:placement,...context}}),signal:controller.signal}).catch(() => {}); };
  const style = document.createElement('style');
  style.textContent = bannerStyles;
  host.hidden = true;
  void (async () => {
    const response = await fetcher(endpoint,{credentials:'include',signal:controller.signal});
    if (!response.ok) return;
    const data = await response.json();
    if (controller.signal.aborted) return;
    if (!data.visible || !data.centerUrl) return;
    const center = new URL(data.centerUrl);
    if (center.protocol !== 'https:' && !['127.0.0.1','localhost'].includes(center.hostname)) return;
    const safeReturn = new URL(returnUrl,location.origin);
    if (safeReturn.origin !== location.origin || safeReturn.username || safeReturn.password) return;
    for (const key of [...safeReturn.searchParams.keys()]) if (!['projectId','courseId','workId','tab','view','from','intent'].includes(key)) safeReturn.searchParams.delete(key);
    if (/token|secret|password|api[_-]?key/i.test(safeReturn.hash)) safeReturn.hash = '';
    else safeReturn.hash = safeReturn.hash.split('?')[0];
    center.searchParams.set('product',productId); center.searchParams.set('entry',placement); center.searchParams.set('return',safeReturn.href);
    const link = text('a',placement === 'paywall' ? '查看联合会员' : '佐学联合大会员 ↗'); link.href = center.href; link.className = placement === 'paywall' ? 'cta' : 'link';
    if (placement === 'paywall') { const arrow = text('span','↗','arrow'); arrow.setAttribute('aria-hidden','true'); link.append(arrow); }
    link.addEventListener('click',() => send('union_clicked'));
    shadow.replaceChildren(style);
    shadow.append(placement === 'paywall' ? renderBanner(productId, data.catalog, link) : link);
    host.hidden = false; visible = true;
    if (placement === 'paywall') {
      const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { send('union_impression'); observer.disconnect(); } },{threshold:0.25});
      observer.observe(host); controller.signal.addEventListener('abort',() => observer.disconnect(),{once:true});
    }
  })().catch(() => {});
  return () => { controller.abort(); if (visible) { shadow.replaceChildren(); host.hidden = true; } };
}
