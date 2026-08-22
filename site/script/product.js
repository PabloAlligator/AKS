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
  const images = (product.images || []).filter((image) => image?.path);

  if (!main || !thumbnails) return;

  main.replaceChildren();
  thumbnails.replaceChildren();
  thumbnails.hidden = true;
  main.removeAttribute('tabindex');
  main.removeAttribute('aria-label');
  main.removeAttribute('aria-roledescription');

  if (!images.length) {
    const placeholder = document.createElement('span');
    placeholder.className = 'product-gallery__placeholder';
    placeholder.textContent = 'AC';
    main.append(placeholder);
    return;
  }

  let activeIndex = 0;

  function createMainImage(image, index) {
    const img = document.createElement('img');
    img.className = 'product-gallery__image';
    img.src = image.path;
    img.alt = image.alt || `${product.name}, фото ${index + 1}`;
    img.draggable = false;
    return img;
  }

  function updateThumbnails() {
    let activeButton = null;

    thumbnails.querySelectorAll('.product-gallery__thumb').forEach((button, index) => {
      const isActive = index === activeIndex;
      button.classList.toggle('product-gallery__thumb--active', isActive);
      button.setAttribute('aria-current', isActive ? 'true' : 'false');

      if (isActive) activeButton = button;
    });

    if (activeButton && window.matchMedia('(max-width: 760px)').matches) {
      const targetLeft =
        activeButton.offsetLeft - (thumbnails.clientWidth - activeButton.offsetWidth) / 2;

      thumbnails.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: 'smooth',
      });
    }
  }

  function showImage(index) {
    activeIndex = (index + images.length) % images.length;
    const nextImage = createMainImage(images[activeIndex], activeIndex);
    const currentImage = main.querySelector('.product-gallery__image');

    if (currentImage) {
      currentImage.replaceWith(nextImage);
    } else {
      main.prepend(nextImage);
    }

    main.setAttribute(
      'aria-label',
      `${product.name}: фото ${activeIndex + 1} из ${images.length}`,
    );
    updateThumbnails();
  }

  main.append(createMainImage(images[0], 0));

  if (images.length === 1) return;

  main.tabIndex = 0;
  main.setAttribute('aria-roledescription', 'carousel');
  main.setAttribute('aria-label', `${product.name}: фото 1 из ${images.length}`);

  const previousButton = document.createElement('button');
  previousButton.type = 'button';
  previousButton.className = 'product-gallery__arrow product-gallery__arrow--prev';
  previousButton.setAttribute('aria-label', 'Предыдущее фото');
  previousButton.textContent = '‹';
  previousButton.addEventListener('click', () => showImage(activeIndex - 1));

  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'product-gallery__arrow product-gallery__arrow--next';
  nextButton.setAttribute('aria-label', 'Следующее фото');
  nextButton.textContent = '›';
  nextButton.addEventListener('click', () => showImage(activeIndex + 1));

  main.append(previousButton, nextButton);

  thumbnails.hidden = false;
  images.forEach((image, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'product-gallery__thumb';
    button.setAttribute('aria-label', `Показать фото ${index + 1}`);

    const img = document.createElement('img');
    img.src = image.path;
    img.alt = image.alt || `${product.name}, фото ${index + 1}`;
    img.loading = 'lazy';
    img.draggable = false;

    button.append(img);
    button.addEventListener('click', () => showImage(index));
    thumbnails.append(button);
  });

  updateThumbnails();

  main.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showImage(activeIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      showImage(activeIndex + 1);
    }
  });

  let touchStartX = 0;
  let touchStartY = 0;

  main.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) return;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    },
    { passive: true },
  );

  main.addEventListener(
    'touchend',
    (event) => {
      if (!event.changedTouches.length) return;

      const deltaX = event.changedTouches[0].clientX - touchStartX;
      const deltaY = event.changedTouches[0].clientY - touchStartY;
      const isHorizontalSwipe =
        Math.abs(deltaX) >= 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15;

      if (!isHorizontalSwipe) return;
      showImage(activeIndex + (deltaX < 0 ? 1 : -1));
    },
    { passive: true },
  );
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
  document.title = product.seoTitle || `${product.name} — купить в Абакане | Автокат Сервис`;
  document.querySelector('meta[name="description"]')?.setAttribute(
    'content',
    product.seoDescription || product.shortDescription || `${product.name}. Оставьте заявку — менеджер AutoCat подтвердит заказ.`,
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
