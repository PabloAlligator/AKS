(function initCartPage() {
  const api = window.AutoCatCatalog;
  const itemsContainer = document.querySelector('[data-cart-items]');
  const content = document.querySelector('[data-cart-content]');
  const empty = document.querySelector('[data-cart-empty]');
  const modal = document.querySelector('[data-cart-checkout-modal]');
  const form = document.querySelector('[data-cart-form]');
  const status = document.querySelector('[data-cart-status]');

  function formatMoney(value) {
    return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
  }

  function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8')) return digits;
    if (digits.length === 11 && digits.startsWith('7')) return `8${digits.slice(1)}`;
    if (digits.length === 10) return `8${digits}`;
    return '';
  }

  function render() {
    const items = api.readCart();
    const count = api.getCartCount(items);
    content.hidden = !items.length;
    empty.hidden = Boolean(items.length);
    document.querySelector('[data-cart-clear]').hidden = !items.length;
    document.querySelector('[data-cart-heading-count]').textContent = items.length ? `· ${count}` : '';
    if (!items.length) return;

    itemsContainer.replaceChildren(...items.map((item) => {
      const article = document.createElement('article');
      article.className = 'cart-item';
      const imageLink = document.createElement('a');
      imageLink.className = 'cart-item__image';
      imageLink.href = `/catalog/${encodeURIComponent(item.slug)}`;
      if (item.image?.path) {
        const img = document.createElement('img');
        img.src = item.image.path;
        img.alt = item.image.alt || item.name;
        imageLink.append(img);
      } else {
        const placeholder = document.createElement('span');
        placeholder.textContent = 'AC';
        imageLink.append(placeholder);
      }
      const info = document.createElement('div');
      info.className = 'cart-item__info';
      const title = document.createElement('a');
      title.href = `/catalog/${encodeURIComponent(item.slug)}`;
      title.textContent = item.name;
      const note = document.createElement('p');
      note.textContent = 'Совместимость и наличие подтвердит менеджер';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Удалить';
      remove.addEventListener('click', () => api.setCartQuantity(item, 0));
      info.append(title, note, remove);
      const controls = document.createElement('div');
      controls.className = 'cart-item__controls';
      const price = document.createElement('strong');
      price.textContent = item.price === null
        ? 'Цена по запросу'
        : item.priceTo !== null && item.priceTo !== undefined
          ? `от ${formatMoney(item.price * item.quantity)} до ${formatMoney(item.priceTo * item.quantity)}`
          : `${item.priceFrom ? 'от ' : ''}${formatMoney(item.price * item.quantity)}`;
      const counter = document.createElement('div');
      counter.className = 'cart-item__counter';
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.textContent = '−';
      minus.addEventListener('click', () => api.setCartQuantity(item, item.quantity - 1));
      const quantity = document.createElement('span');
      quantity.textContent = String(item.quantity);
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.textContent = '+';
      plus.disabled = item.quantity >= 99;
      plus.addEventListener('click', () => api.setCartQuantity(item, item.quantity + 1));
      counter.append(minus, quantity, plus);
      controls.append(price, counter);
      article.append(imageLink, info, controls);
      return article;
    }));

    const knownTotal = items.reduce((sum, item) => sum + (item.price === null ? 0 : item.price * item.quantity), 0);
    document.querySelector('[data-cart-total-count]').textContent = String(count);
    document.querySelector('[data-cart-total-price]').textContent = formatMoney(knownTotal);
    document.querySelector('[data-cart-price-note]').hidden = !items.some((item) => item.price === null);
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('catalog-modal-open');
  }

  function setMessage(message, success = false) {
    const element = document.querySelector('[data-cart-message]');
    element.textContent = message;
    element.hidden = !message;
    element.classList.toggle('catalog-inquiry__message--success', success);
  }

  function setStatus(message = '', type = 'error') {
    if (!status) return;

    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('cart-status--success', type === 'success');
  }

  function requestItems(items = api.readCart()) {
    return items.map((item) => ({
      productId: item.id,
      quantity: item.quantity,
    }));
  }

  async function refreshCartFromServer() {
    const localItems = api.readCart();

    if (!localItems.length) return;

    setStatus('Проверяем актуальные цены…');

    try {
      const response = await fetch('/api/cart/quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: requestItems(localItems),
        }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Не удалось обновить цены');
      }

      api.writeCart(result.items);

      if (result.unavailableProductIds?.length) {
        setStatus('Недоступные товары удалены. Цены остальных позиций обновлены.');
      } else {
        setStatus('Цены проверены по каталогу.', 'success');
        window.setTimeout(() => setStatus(''), 2200);
      }
    } catch (error) {
      setStatus(
        error.message || 'Не удалось обновить цены. Попробуйте перезагрузить страницу.',
      );
    }
  }

  document.querySelector('[data-cart-clear]')?.addEventListener('click', () => api.writeCart([]));
  document.querySelector('[data-cart-checkout]')?.addEventListener('click', () => {
    setMessage('');
    modal.hidden = false;
    document.body.classList.add('catalog-modal-open');
    window.setTimeout(() => form.querySelector('input[name="name"]')?.focus(), 40);
  });
  document.querySelectorAll('[data-cart-checkout-close]').forEach((button) => button.addEventListener('click', closeModal));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage('');
    if (!form.checkValidity()) return form.reportValidity();
    const items = api.readCart();
    if (!items.length) return closeModal();
    const data = new FormData(form);
    const phone = normalizePhone(data.get('phone'));
    if (!/^89\d{9}$/.test(phone)) return setMessage('Проверьте номер телефона');
    const car = String(data.get('car') || '').trim();
    const comment = String(data.get('comment') || '').trim();
    const submit = form.querySelector('[type="submit"]');
    const originalText = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'Отправляем…';
    try {
      const response = await fetch('/api/cart/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(data.get('name') || '').trim(),
          phone,
          car,
          comment,
          website: String(data.get('website') || ''),
          items: requestItems(items),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.message || 'Не удалось отправить заказ');
      api.writeCart([]);
      form.reset();
      setMessage('Заказ принят. Менеджер свяжется с вами.', true);
      window.setTimeout(closeModal, 2600);
    } catch (error) {
      setMessage(error.message || 'Не удалось отправить заказ');
    } finally {
      submit.disabled = false;
      submit.textContent = originalText;
    }
  });

  api.initCartBadge();
  window.addEventListener('autocat:cart-change', render);
  window.addEventListener('storage', render);
  render();
  refreshCartFromServer();
})();
