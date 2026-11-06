import { mountUnionOffer } from './widget.js';
const names={keban:'课伴',aiprd:'AI PRD',aipm:'AI PM 作品集',workflow:'Vibe Workflow',pattern:'产品范式'};
const {catalog}=await (await fetch('/api/me')).json();
let group='B',unmount=()=>{};
function render(){
  unmount();
  const productId=document.querySelector('#preview-product').value;
  document.querySelector('#wall-title').textContent=`${names[productId]} · 会员套餐`;
  document.querySelector('#control').setAttribute('aria-pressed',String(group==='A'));
  document.querySelector('#treatment').setAttribute('aria-pressed',String(group==='B'));
  document.querySelector('#group-note').textContent=group==='B'?'B 组展示新增卡片；当前产品排在首位。':'A 组保持原有结构；新增卡片完全隐藏。';
  unmount=mountUnionOffer(document.querySelector('#wall-offer'),{productId,placement:'paywall',returnUrl:location.href,events:false,fetcher:async()=>Response.json({visible:group==='B',purchasable:false,catalog,centerUrl:location.origin})});
}
document.querySelector('#preview-product').addEventListener('change',render);
document.querySelector('#control').addEventListener('click',()=>{group='A';render();});
document.querySelector('#treatment').addEventListener('click',()=>{group='B';render();});
render();
