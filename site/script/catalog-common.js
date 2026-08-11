(function initCatalogCommon() {
  const state = {
    activeProduct: null,
  };
  const CART_STORAGE_KEY = 'autocat-cart-v1';
  const CART_MAX_QUANTITY = 99;

  function readCart() {
    try {
      const value = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
      return Array.isArray(value)
        ? value.filter((item) => item && Number.isInteger(item.id) && item.quantity > 0)
        : [];
    } catch {
      return [];
    }
  }

  function writeCart(items) {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('autocat:cart-change', { detail: items }));
  }

  function productSnapshot(product, quantity = 1) {
    return {
      id: Number(product.id),
      slug: product.slug,
      name: product.name,
      price: product.price === null || product.price === undefined ? null : Number(product.price),
      priceFrom: Boolean(product.priceFrom),
      image: getProductImage(product),
      quantity,
    };
  }

  function getCartQuantity(productId) {
    return readCart().find((item) => item.id === Number(productId))?.quantity || 0;
  }

  function setCartQuantity(product, quantity) {
    const items = readCart();
    const index = items.findIndex((item) => item.id === Number(product.id));
    const nextQuantity = Math.max(0, Math.min(CART_MAX_QUANTITY, Number(quantity) || 0));

    if (nextQuantity === 0) {
      if (index !== -1) items.splice(index, 1);
    } else if (index === -1) {
      items.push(productSnapshot(product, nextQuantity));
    } else {
      items[index] = productSnapshot(product, nextQuantity);
    }

    writeCart(items);
    return nextQuantity;
  }

  function getCartCount(items = readCart()) {
    return items.reduce((sum, item) => sum + item.quantity, 0);
  }

  function initCartBadge() {
    const badges = document.querySelectorAll('[data-cart-count]');
    const update = (items = readCart()) => {
      const count = getCartCount(items);
      badges.forEach((badge) => {
        badge.textContent = count;
        badge.hidden = count === 0;
      });
    };

    update();
    window.addEventListener('autocat:cart-change', (event) => update(event.detail));
    window.addEventListener('storage', () => update());
  }

  function createCartControl(product, classPrefix = 'catalog-card') {
    const control = document.createElement('div');
    control.className = `${classPrefix}__cart-control`;

    const render = () => {
      const quantity = getCartQuantity(product.id);
      control.replaceChildren();

      if (!quantity) {
        const buyButton = document.createElement('button');
        buyButton.className = `${classPrefix}__request`;
        buyButton.type = 'button';
        buyButton.textContent = 'Купить';
        buyButton.setAttribute('aria-label', `Добавить ${product.name} в корзину`);
        buyButton.addEventListener('click', () => setCartQuantity(product, 1));
        control.append(buyButton);
        return;
      }

      const inCart = document.createElement('a');
      inCart.className = `${classPrefix}__in-cart`;
      inCart.href = '/cart';
      inCart.textContent = 'В корзине';

      const counter = document.createElement('div');
      counter.className = `${classPrefix}__counter`;
      const decrement = document.createElement('button');
      decrement.type = 'button';
      decrement.textContent = '−';
      decrement.setAttribute('aria-label', `Уменьшить количество ${product.name}`);
      decrement.addEventListener('click', () => setCartQuantity(product, quantity - 1));
      const value = document.createElement('span');
      value.textContent = String(quantity);
      value.setAttribute('aria-label', `${quantity} в корзине`);
      const increment = document.createElement('button');
      increment.type = 'button';
      increment.textContent = '+';
      increment.disabled = quantity >= CART_MAX_QUANTITY;
      increment.setAttribute('aria-label', `Увеличить количество ${product.name}`);
      increment.addEventListener('click', () => setCartQuantity(product, quantity + 1));
      counter.append(decrement, value, increment);
      control.append(inCart, counter);
    };

    render();
    window.addEventListener('autocat:cart-change', render);
    window.addEventListener('storage', render);
    return control;
  }

  function formatPrice(product) {
    if (product?.price === null || product?.price === undefined) {
      return 'Цена по запросу';
    }

    const value = new Intl.NumberFormat('ru-RU').format(product.price);
    return `${product.priceFrom ? 'от ' : ''}${value} ₽`;
  }

  function getProductImage(product) {
    return product?.images?.[0] || null;
  }

  function createProductCard(product) {
    const article = document.createElement('article');
    article.className = 'catalog-card';

    const imageLink = document.createElement('a');
    imageLink.className = 'catalog-card__image';
    imageLink.href = `/catalog/${encodeURIComponent(product.slug)}`;
    imageLink.setAttribute('aria-label', `Открыть товар ${product.name}`);

    const image = getProductImage(product);

    if (image) {
      const img = document.createElement('img');
      img.src = image.path;
      img.alt = image.alt || product.name;
      img.loading = 'lazy';
      imageLink.append(img);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'catalog-card__placeholder';
      placeholder.textContent = 'AC';
      imageLink.append(placeholder);
    }

    const body = document.createElement('div');
    body.className = 'catalog-card__body';

    const category = document.createElement('span');
    category.className = 'catalog-card__category';
    category.textContent = product.category?.name || product.brand || 'Каталог AutoCat';

    const title = document.createElement('h3');
    title.className = 'catalog-card__title';
    const titleLink = document.createElement('a');
    titleLink.href = `/catalog/${encodeURIComponent(product.slug)}`;
    titleLink.textContent = product.name;
    title.append(titleLink);

    const detail = document.createElement('p');
    detail.className = 'catalog-card__detail';
    detail.textContent = 'Совместимость и заказ подтвердит менеджер';

    const price = document.createElement('strong');
    price.className = 'catalog-card__price';
    price.textContent = formatPrice(product);

    const bottom = document.createElement('div');
    bottom.className = 'catalog-card__bottom';

    const moreLink = document.createElement('a');
    moreLink.className = 'catalog-card__more';
    moreLink.href = `/catalog/${encodeURIComponent(product.slug)}`;
    moreLink.textContent = 'Подробнее';

    const cartControl = createCartControl(product);

    bottom.append(price, moreLink);
    body.append(category, title, detail, bottom, cartControl);
    article.append(imageLink, body);

    return article;
  }

  function setInquiryMessage(message, type = 'error') {
    const element = document.querySelector('[data-catalog-inquiry-message]');

    if (!element) return;

    element.textContent = message;
    element.hidden = !message;
    element.classList.toggle('catalog-inquiry__message--success', type === 'success');
  }

  function openInquiry(product) {
    const modal = document.querySelector('[data-catalog-inquiry]');
    const productName = document.querySelector('[data-catalog-inquiry-product]');
    const serviceInput = document.querySelector('[data-catalog-inquiry-service]');
    const pageInput = document.querySelector('[data-catalog-inquiry-page]');

    if (!modal || !product) return;

    state.activeProduct = product;

    if (productName) productName.textContent = product.name;
    if (serviceInput) serviceInput.value = `Каталог: ${product.name}`;
    if (pageInput) pageInput.value = `/catalog/${product.slug}`;

    setInquiryMessage('');
    modal.hidden = false;
    document.body.classList.add('catalog-modal-open');

    window.setTimeout(() => {
      modal.querySelector('input[name="name"]')?.focus();
    }, 40);
  }

  function closeInquiry() {
    const modal = document.querySelector('[data-catalog-inquiry]');

    if (!modal) return;

    modal.hidden = true;
    document.body.classList.remove('catalog-modal-open');
    state.activeProduct = null;
  }

  function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');

    if (digits.length === 11 && digits.startsWith('8')) return digits;
    if (digits.length === 11 && digits.startsWith('7')) return `8${digits.slice(1)}`;
    if (digits.length === 10) return `8${digits}`;

    return '';
  }

  function initInquiry() {
    const form = document.querySelector('[data-catalog-inquiry-form]');

    document.querySelectorAll('[data-catalog-inquiry-close]').forEach((button) => {
      button.addEventListener('click', closeInquiry);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeInquiry();
    });

    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setInquiryMessage('');

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const formData = new FormData(form);
      const phone = normalizePhone(formData.get('phone'));

      if (!/^89\d{9}$/.test(phone)) {
        setInquiryMessage('Проверьте номер телефона');
        return;
      }

      const submit = form.querySelector('[type="submit"]');
      const originalText = submit?.textContent;

      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Отправляем…';
      }

      const car = String(formData.get('car') || '').trim();
      const comment = String(formData.get('comment') || '').trim();
      const combinedComment = [
        car ? `Автомобиль: ${car}` : '',
        comment ? `Комментарий: ${comment}` : '',
      ]
        .filter(Boolean)
        .join('. ');

      try {
        const response = await fetch('/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: String(formData.get('name') || '').trim(),
            phone,
            service: String(formData.get('service') || '').trim(),
            comment: combinedComment || 'Заявка из каталога',
            page: String(formData.get('page') || window.location.pathname),
            website: String(formData.get('website') || ''),
          }),
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Не удалось отправить заявку');
        }

        form.reset();
        setInquiryMessage(
          'Заявка принята. Менеджер свяжется с вами и подтвердит заказ.',
          'success',
        );

        window.setTimeout(closeInquiry, 2600);
      } catch (error) {
        setInquiryMessage(
          error.message || 'Не удалось отправить заявку. Попробуйте позже.',
        );
      } finally {
        if (submit) {
          submit.disabled = false;
          submit.textContent = originalText;
        }
      }
    });
  }

  window.AutoCatCatalog = {
    createProductCard,
    createCartControl,
    formatPrice,
    getCartCount,
    getCartQuantity,
    getProductImage,
    initInquiry,
    initCartBadge,
    openInquiry,
    readCart,
    setCartQuantity,
    writeCart,
  };
})();
