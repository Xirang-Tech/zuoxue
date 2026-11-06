import { PRODUCT_MEDIA } from './media.js';
import { planQuota } from './member-view.js';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function productCapture(media) {
  const image = element('img', '', 'capture');
  image.src = media.image;
  image.alt = media.alt;
  image.width = media.width;
  image.height = media.height;
  image.decoding = 'async';
  return image;
}

export function createShowcase(sourceId) {
  const find = selector => document.querySelector(selector);
  const tabs = find('#product-tabs');
  const panel = find('#product-panel');
  const screen = find('#hero-screen');
  const dialog = find('#image-dialog');
  const name = find('#showcase-name');
  const tier = find('#showcase-tier');
  let selected = Object.hasOwn(PRODUCT_MEDIA, sourceId) ? sourceId : 'keban';
  let products = [];
  let planId = 'monthly';
  let signature = '';

  function renderSelection() {
    const media = PRODUCT_MEDIA[selected];
    tabs.querySelectorAll('[role=tab]').forEach(tab => {
      const active = tab.dataset.product === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    panel.setAttribute('aria-labelledby', 'product-tab-' + selected);
    panel.dataset.tone = media.tone;
    name.textContent = products.find(product => product.id === selected).name;
    find('#showcase-scene').textContent = media.scene;
    find('#showcase-audience').textContent = media.audience;
    find('#showcase-steps').textContent = media.steps;
    find('#showcase-result').textContent = media.result;
    screen.replaceChildren(productCapture(media));
    screen.setAttribute('aria-label', '放大查看' + name.textContent + '示例');
    find('#hero-caption').textContent = media.example;
    find('#hero-image-label').textContent = media.label;
  }

  function updateEntitlement() {
    const product = products.find(product => product.id === selected);
    tier.textContent = product.tierName;
    tier.hidden = !product.tierName;
    find('#showcase-cycle').textContent = planId === 'yearly' ? '年卡' : '月卡';
    find('#showcase-quota').textContent = planQuota(product, planId);
  }

  function select(id) {
    if (id !== selected) {
      selected = id;
      renderSelection();
      updateEntitlement();
    }
  }

  function open() {
    const media = PRODUCT_MEDIA[selected];
    find('#image-title').textContent = media.example;
    find('#image-description').textContent = name.textContent + ' · ' + media.label;
    const content = find('#image-content');
    content.replaceChildren(productCapture(media));
    content.scrollLeft = 0;
    dialog.showModal();
  }

  screen.addEventListener('click', open);
  find('#hero-zoom').addEventListener('click', open);
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = products.findIndex(product => product.id === selected);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? products.length - 1
      : (index + step + products.length) % products.length;
    select(products[next].id);
    find('#product-tab-' + selected).focus();
  });

  return {
    update(items, selectedPlanId) {
      planId = selectedPlanId;
      products = items.filter(product => Object.hasOwn(PRODUCT_MEDIA, product.id));
      const nextSignature = JSON.stringify(products.map(({id, name}) => [id, name]));
      if (nextSignature !== signature) {
        signature = nextSignature;
        if (!products.some(product => product.id === selected)) selected = products[0].id;
        tabs.replaceChildren(...products.map(({id, name}) => {
          const media = PRODUCT_MEDIA[id];
          const tab = element('button', '', 'product-tab');
          tab.type = 'button';
          tab.id = 'product-tab-' + id;
          tab.dataset.product = id;
          tab.setAttribute('role', 'tab');
          tab.setAttribute('aria-controls', 'product-panel');
          const logo = element('img');
          logo.src = media.logo;
          logo.alt = '';
          logo.width = 28;
          logo.height = 28;
          const copy = element('span', '', 'product-tab-copy');
          copy.append(element('strong', name), element('span', media.use, 'product-use'));
          tab.append(logo, copy);
          tab.addEventListener('click', () => select(id));
          return tab;
        }));
        renderSelection();
      }
      updateEntitlement();
    },
  };
}
