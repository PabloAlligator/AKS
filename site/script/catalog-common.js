(function initCatalogCommon() {
  const state = {
    activeProduct: null,
  };

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

    const requestButton = document.createElement('button');
    requestButton.className = 'catalog-card__request';
    requestButton.type = 'button';
    requestButton.textContent = 'Купить';
    requestButton.setAttribute('aria-label', `Оставить заявку на ${product.name}`);
    requestButton.addEventListener('click', () => openInquiry(product));

    bottom.append(price, moreLink, requestButton);
    body.append(category, title, detail, bottom);
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
    formatPrice,
    getProductImage,
    initInquiry,
    openInquiry,
  };
})();
