function setProductState(message, type = 'loading') {
  const status = document.querySelector('[data-product-status]');
  const content = document.querySelector('[data-product-content]');

  if (status) {
    status.textContent = message;
    status.hidden = !message;
    status.dataset.state = type;
  }

  if (content) content.hidden = Boolean(message);
}

function renderProductGallery(product) {
  const main = document.querySelector('[data-product-main-image]');
  const thumbnails = document.querySelector('[data-product-thumbnails]');
  const images = product.images || [];

  if (!main || !thumbnails) return;

  thumbnails.replaceChildren();

  function setMainImage(image) {
    main.replaceChildren();

    if (!image) {
      const placeholder = document.createElement('span');
      placeholder.className = 'product-gallery__placeholder';
      placeholder.textContent = 'AC';
      main.append(placeholder);
      return;
    }

    const img = document.createElement('img');
    img.src = image.path;
    img.alt = image.alt || product.name;
    main.append(img);
  }

  setMainImage(images[0]);

  if (images.length <= 1) {
    thumbnails.hidden = true;
    return;
  }

  thumbnails.hidden = false;
  images.forEach((image, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'product-gallery__thumb';
    button.classList.toggle('product-gallery__thumb--active', index === 0);
    const img = document.createElement('img');
    img.src = image.path;
    img.alt = image.alt || `${product.name}, фото ${index + 1}`;
    button.append(img);
    button.addEventListener('click', () => {
      thumbnails.querySelectorAll('button').forEach((item) => {
        item.classList.remove('product-gallery__thumb--active');
      });
      button.classList.add('product-gallery__thumb--active');
      setMainImage(image);
    });
    thumbnails.append(button);
  });
}

function renderSpecifications(value) {
  const container = document.querySelector('[data-product-specifications]');

  if (!container) return;

  container.replaceChildren();
  const lines = String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    container.closest('.product-details__section').hidden = true;
    return;
  }

  lines.forEach((line) => {
    const [label, ...rest] = line.split(':');
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = rest.length ? label.trim() : 'Характеристика';
    description.textContent = rest.length ? rest.join(':').trim() : label.trim();
    row.append(term, description);
    container.append(row);
  });
}

function updateMeta(product) {
  document.title = `${product.name} — каталог Автокат Сервис`;
  document.querySelector('meta[name="description"]')?.setAttribute(
    'content',
    product.shortDescription || `${product.name}. Оставьте заявку — менеджер AutoCat подтвердит заказ.`,
  );
  document.querySelector('link[rel="canonical"]')?.setAttribute(
    'href',
    `https://autocat-abakan.ru/catalog/${product.slug}`,
  );
}

function renderProduct(product, relatedProducts) {
  updateMeta(product);
  renderProductGallery(product);

  const values = {
    '[data-product-category]': product.category?.name || 'Каталог AutoCat',
    '[data-product-name]': product.name,
    '[data-product-summary]':
      product.shortDescription || 'Подробности и совместимость уточнит менеджер.',
    '[data-product-price]': window.AutoCatCatalog.formatPrice(product),
    '[data-product-brand]': product.brand || '—',
    '[data-product-sku]': product.sku || '—',
    '[data-product-description]':
      product.description ||
      'Оставьте заявку, и менеджер уточнит характеристики, совместимость и условия получения товара.',
  };

  Object.entries(values).forEach(([selector, value]) => {
    document.querySelectorAll(selector).forEach((element) => {
      element.textContent = value;
    });
  });

  const cartTarget = document.querySelector('[data-product-cart]');
  if (cartTarget) {
    cartTarget.replaceChildren(window.AutoCatCatalog.createCartControl(product, 'product-info'));
  }

  renderSpecifications(product.specifications);

  const relatedSection = document.querySelector('[data-related-section]');
  const relatedGrid = document.querySelector('[data-related-grid]');

  if (relatedSection && relatedGrid) {
    relatedSection.hidden = !relatedProducts.length;
    relatedGrid.replaceChildren(
      ...relatedProducts.map((item) => window.AutoCatCatalog.createProductCard(item)),
    );
  }

  setProductState('');
}

async function loadProduct() {
  const slug = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');
  setProductState('Загружаем товар…');

  try {
    const response = await fetch(`/api/catalog/products/${encodeURIComponent(slug)}`);
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.product) {
      throw new Error(data.message || 'Товар не найден');
    }

    renderProduct(data.product, data.relatedProducts || []);
  } catch (error) {
    setProductState(error.message || 'Не удалось открыть товар', 'error');
  }
}

window.AutoCatCatalog.initInquiry();
window.AutoCatCatalog.initCartBadge();
loadProduct();
