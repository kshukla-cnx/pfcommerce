import { createOptimizedPicture } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

/*
 * PageForge product grid.
 *
 * Content contract (one row per product, cells left to right):
 *   [ picture ] [ <h3>Name</h3> <p>Description</p> <p><strong>Price</strong></p> ] [ Category ]
 *
 * A leading row with a single cell is the section intro: the paragraph(s) before
 * the heading become the eyebrow, the one(s) after it the tagline.
 *
 * Category cells are optional, and an empty cell counts as no category - the
 * composer template emits <div></div> when a product has none. When two or more
 * distinct categories are present the block renders a tab list that filters the
 * grid; with fewer, the tabs are omitted.
 */

/** Label of the tab that clears the filter. */
const ALL_LABEL = 'All Product';

let instanceCount = 0;

/** Normalises a category label into a comparable key. */
function toKey(label) {
  return label.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Picks the paragraph that holds the price: the one that is entirely emphasised,
 * or else the trailing paragraph once a description is present.
 * @param {Element[]} paragraphs
 * @returns {Element|null}
 */
function findPrice(paragraphs) {
  const emphasised = paragraphs.find((p) => p.children.length === 1
    && p.firstElementChild.matches('strong, b, em, i')
    && p.firstElementChild.textContent.trim() === p.textContent.trim());
  if (emphasised) return emphasised;
  return paragraphs.length > 1 ? paragraphs[paragraphs.length - 1] : null;
}

/**
 * Turns the single-cell leading row into the centred section intro.
 * @param {Element} row
 * @returns {Element}
 */
function buildIntro(row) {
  const intro = document.createElement('div');
  intro.className = 'product-grid-intro';
  moveInstrumentation(row, intro);
  while (row.firstElementChild.firstElementChild) {
    intro.append(row.firstElementChild.firstElementChild);
  }

  const hasHeading = !!intro.querySelector('h1, h2, h3, h4, h5, h6');
  let afterHeading = !hasHeading;
  [...intro.children].forEach((child) => {
    if (child.matches('h1, h2, h3, h4, h5, h6')) {
      afterHeading = true;
      return;
    }
    child.classList.add(afterHeading ? 'product-grid-tagline' : 'product-grid-eyebrow');
  });

  return intro;
}

/**
 * Turns one content row into a product card.
 * @param {Element} row
 * @param {Map<string, string>} categories collects key -> label in document order
 * @returns {Element}
 */
function buildCard(row, categories) {
  const card = document.createElement('li');
  card.className = 'product-grid-card';
  moveInstrumentation(row, card);

  const cells = [...row.children];
  const media = cells.find((cell) => cell.querySelector('picture'));
  const [body, ...rest] = cells.filter((cell) => cell !== media);

  if (media) {
    media.className = 'product-grid-media';
    card.append(media);
  }

  if (body) {
    body.className = 'product-grid-body';
    const title = body.querySelector('h1, h2, h3, h4, h5, h6');
    if (title) title.classList.add('product-grid-title');

    const paragraphs = [...body.querySelectorAll(':scope > p')];
    const price = findPrice(paragraphs);
    paragraphs.forEach((p) => {
      p.classList.add(p === price ? 'product-grid-price' : 'product-grid-description');
    });
    // the price always closes the card, whatever order the author used
    if (price) body.append(price);

    if (title && title.querySelector('a')) card.classList.add('product-grid-card-linked');
    card.append(body);
  }

  const label = rest.map((cell) => cell.textContent.trim()).find(Boolean);
  if (label) {
    const key = toKey(label);
    card.dataset.category = key;
    if (!categories.has(key)) categories.set(key, label);
  }

  return card;
}

/**
 * Builds the filter tab list.
 * @param {string[]} labels category labels, in document order
 * @param {string} uid unique prefix for the tab ids
 * @returns {Element}
 */
function buildTabs(labels, uid) {
  const tablist = document.createElement('div');
  tablist.className = 'product-grid-filters';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Filter products by category');

  [ALL_LABEL, ...labels].forEach((label, i) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'product-grid-filter';
    tab.id = `${uid}-tab-${i}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    tab.tabIndex = i === 0 ? 0 : -1;
    tab.dataset.category = i === 0 ? '' : toKey(label);
    // reserves the bold width so selecting a tab does not shift the row
    tab.dataset.label = label;
    tab.textContent = label;
    tablist.append(tab);
  });

  return tablist;
}

/**
 * Applies a tab selection to the tab list and the grid.
 * @param {Element} tablist
 * @param {Element} panel
 * @param {Element} tab
 */
function selectTab(tablist, panel, tab) {
  [...tablist.children].forEach((candidate) => {
    const selected = candidate === tab;
    candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
    candidate.tabIndex = selected ? 0 : -1;
  });

  const { category } = tab.dataset;
  panel.querySelectorAll('.product-grid-card').forEach((card) => {
    card.hidden = !!category && card.dataset.category !== category;
  });
  panel.setAttribute('aria-labelledby', tab.id);
}

/**
 * Wires click and roving-tabindex keyboard support onto the tab list.
 * @param {Element} tablist
 * @param {Element} panel
 */
function addTabBehaviour(tablist, panel) {
  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) selectTab(tablist, panel, tab);
  });

  tablist.addEventListener('keydown', (event) => {
    const tabs = [...tablist.children];
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;

    const targets = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in targets)) return;

    event.preventDefault();
    const next = tabs[(targets[event.key] + tabs.length) % tabs.length];
    next.focus();
    selectTab(tablist, panel, next);
  });
}

/**
 * Hands the image to the AEM media pipeline. Cross-origin sources are left alone
 * because the pipeline only serves paths from this origin.
 * @param {HTMLImageElement} img
 */
function optimizeImage(img) {
  if (new URL(img.src, window.location.href).origin !== window.location.origin) return;
  const picture = createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]);
  moveInstrumentation(img, picture.querySelector('img'));
  img.closest('picture').replaceWith(picture);
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  instanceCount += 1;
  const uid = `product-grid-${instanceCount}`;

  const rows = [...block.children];
  const introRow = rows[0]?.children.length === 1 ? rows.shift() : null;

  const categories = new Map();
  const list = document.createElement('ul');
  list.className = 'product-grid-list';
  rows.forEach((row) => list.append(buildCard(row, categories)));

  const content = document.createDocumentFragment();
  if (introRow) content.append(buildIntro(introRow));

  let tablist;
  let panel = list;
  if (categories.size > 1) {
    tablist = buildTabs([...categories.values()], uid);
    panel = document.createElement('div');
    panel.className = 'product-grid-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `${uid}-tab-0`);
    panel.append(list);
    content.append(tablist);
  }
  content.append(panel);

  block.replaceChildren(content);
  if (tablist) addTabBehaviour(tablist, panel);
  block.querySelectorAll('picture > img').forEach(optimizeImage);
}
