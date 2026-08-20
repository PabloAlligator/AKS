const adminPage = document.body.dataset.adminPage;

const ROLE_LABELS = {
  OWNER: 'Владелец',
  STAFF: 'Сотрудник',
};

const STATUS_LABELS = {
  NEW: 'Новая',
  IN_PROGRESS: 'В работе',
  COMPLETED: 'Завершена',
  CANCELLED: 'Отменена',
};

let cachedCsrfToken = '';

const LIVE_REFRESH_INTERVAL_MS = 10 * 1000;

function startLiveRefresh(callback) {
  let isRunning = false;

  const run = async () => {
    if (document.hidden || isRunning) {
      return;
    }

    isRunning = true;

    try {
      await callback();
    } catch (error) {
      console.error('Live refresh error:', error);
    } finally {
      isRunning = false;
    }
  };

  const intervalId = window.setInterval(run, LIVE_REFRESH_INTERVAL_MS);

  const handleVisibilityChange = () => {
    if (!document.hidden) {
      run();
    }
  };

  const handleWindowFocus = () => {
    run();
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);

  window.addEventListener('focus', handleWindowFocus);

  window.addEventListener(
    'beforeunload',
    () => {
      window.clearInterval(intervalId);

      document.removeEventListener('visibilitychange', handleVisibilityChange);

      window.removeEventListener('focus', handleWindowFocus);
    },
    {
      once: true,
    },
  );

  return intervalId;
}

function getAdminTarget(user) {
  return user?.role === 'OWNER' ? '/admin/dashboard' : '/admin/requests';
}

async function requestJson(url, options = {}) {
  const { headers = {}, ...requestOptions } = options;

  const response = await fetch(url, {
    credentials: 'same-origin',
    ...requestOptions,
    headers: {
      Accept: 'application/json',
      ...(requestOptions.body
        ? {
            'Content-Type': 'application/json',
          }
        : {}),
      ...headers,
    },
  });

  const data = await response.json().catch(() => null);

  return {
    response,
    data,
  };
}

async function requestFormData(url, formData, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    method: options.method || 'POST',
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    body: formData,
  });

  const data = await response.json().catch(() => null);

  return {
    response,
    data,
  };
}

function redirectToLogin() {
  window.location.replace('/admin/login');
}

function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (digits.length !== 11 || !digits.startsWith('8')) {
    return value || '—';
  }

  return `+7 (${digits.slice(1, 4)}) ${digits.slice(
    4,
    7,
  )}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}

function makePhoneLink(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (digits.length !== 11 || !digits.startsWith('8')) {
    return '';
  }

  return `tel:+7${digits.slice(1)}`;
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Krasnoyarsk',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function setUserData(user) {
  document.querySelectorAll('[data-admin-user-name]').forEach((element) => {
    element.textContent = user?.name || 'пользователь';
  });

  document.querySelectorAll('[data-admin-user-email]').forEach((element) => {
    element.textContent = user?.email || '—';
  });

  document.querySelectorAll('[data-admin-user-role]').forEach((element) => {
    element.textContent = ROLE_LABELS[user?.role] || user?.role || '—';
  });

  document.querySelectorAll('[data-owner-only]').forEach((element) => {
    element.hidden = user?.role !== 'OWNER';
  });
}

async function getCurrentUser() {
  const { response, data } = await requestJson('/admin/api/auth/me');

  if (response.status === 401) {
    redirectToLogin();
    return null;
  }

  if (!response.ok || !data?.user) {
    throw new Error(data?.message || 'Не удалось проверить авторизацию');
  }

  return data.user;
}

async function getCsrfToken() {
  if (cachedCsrfToken) {
    return cachedCsrfToken;
  }

  const { response, data } = await requestJson('/admin/api/auth/csrf');

  if (response.status === 401) {
    redirectToLogin();
    return '';
  }

  if (!response.ok || !data?.csrfToken) {
    throw new Error(data?.message || 'Не удалось получить CSRF-токен');
  }

  cachedCsrfToken = data.csrfToken;

  return cachedCsrfToken;
}

function initLogout() {
  const buttons = document.querySelectorAll('[data-admin-logout]');

  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      const originalText = button.textContent;

      button.disabled = true;
      button.textContent = 'Выходим…';

      try {
        const csrfToken = await getCsrfToken();

        if (!csrfToken) return;

        const { response, data } = await requestJson('/admin/api/auth/logout', {
          method: 'POST',
          headers: {
            'X-CSRF-Token': csrfToken,
          },
        });

        if (!response.ok && response.status !== 401) {
          throw new Error(data?.message || 'Не удалось выйти');
        }

        cachedCsrfToken = '';
        redirectToLogin();
      } catch (error) {
        console.error('Admin logout error:', error);

        button.disabled = false;
        button.textContent = originalText;
      }
    });
  });
}

/* LOGIN */

function setLoginMessage(element, message, type = 'error') {
  element.textContent = message;
  element.hidden = !message;

  element.classList.toggle('admin-login__message--success', type === 'success');
}

function setLoginLoading(button, loader, text, isLoading) {
  button.disabled = isLoading;
  loader.hidden = !isLoading;

  text.textContent = isLoading ? 'Выполняется вход' : 'Войти в панель';
}

async function checkExistingSession() {
  const { response, data } = await requestJson('/admin/api/auth/me');

  if (!response.ok || !data?.user) {
    return;
  }

  window.location.replace(getAdminTarget(data.user));
}

function initPasswordToggle() {
  const button = document.querySelector('[data-password-toggle]');

  const input = document.querySelector('[data-admin-password]');

  const text = document.querySelector('[data-password-toggle-text]');

  if (!button || !input || !text) {
    return;
  }

  button.addEventListener('click', () => {
    const isVisible = input.type === 'text';

    input.type = isVisible ? 'password' : 'text';

    button.setAttribute('aria-pressed', String(!isVisible));

    button.setAttribute(
      'aria-label',
      isVisible ? 'Показать пароль' : 'Скрыть пароль',
    );

    text.textContent = isVisible ? 'Показать' : 'Скрыть';
  });
}

async function initLoginPage() {
  const form = document.querySelector('[data-admin-login-form]');

  const emailInput = document.querySelector('[data-admin-email]');

  const passwordInput = document.querySelector('[data-admin-password]');

  const message = document.querySelector('[data-admin-login-message]');

  const submitButton = document.querySelector('[data-admin-login-submit]');

  const submitText = document.querySelector('[data-admin-login-submit-text]');

  const loader = document.querySelector('[data-admin-login-loader]');

  if (
    !form ||
    !emailInput ||
    !passwordInput ||
    !message ||
    !submitButton ||
    !submitText ||
    !loader
  ) {
    return;
  }

  await checkExistingSession();
  initPasswordToggle();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    setLoginMessage(message, '');

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const email = emailInput.value.trim().toLowerCase();

    const password = passwordInput.value;

    setLoginLoading(submitButton, loader, submitText, true);

    try {
      const { response, data } = await requestJson('/admin/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
        }),
      });

      if (!response.ok) {
        setLoginMessage(message, data?.message || 'Не удалось выполнить вход');

        return;
      }

      setLoginMessage(message, 'Вход выполнен. Открываем панель…', 'success');

      window.location.replace(getAdminTarget(data.user));
    } catch (error) {
      console.error('Admin login error:', error);

      setLoginMessage(message, 'Сервер временно недоступен');
    } finally {
      setLoginLoading(submitButton, loader, submitText, false);
    }
  });
}

/* DASHBOARD */

function setDashboardMessage(message) {
  const element = document.querySelector('[data-dashboard-message]');

  if (!element) return;

  element.textContent = message;
  element.hidden = !message;
}

function setDashboardLoading(isLoading) {
  const loading = document.querySelector('[data-dashboard-loading]');

  const content = document.querySelector('[data-dashboard-content]');

  if (loading) {
    loading.hidden = !isLoading;
  }

  if (content) {
    content.hidden = isLoading;
  }
}

function renderDashboardCounts(counts = {}) {
  document
    .querySelectorAll('[data-dashboard-lead-count]')
    .forEach((element) => {
      const key = element.dataset.dashboardLeadCount;

      element.textContent = Number(counts[key]) || 0;
    });
}

function renderDashboardContent(content = {}) {
  document
    .querySelectorAll('[data-dashboard-content-count]')
    .forEach((element) => {
      const key = element.dataset.dashboardContentCount;

      element.textContent = Number(content[key]) || 0;
    });
}

function createLatestLeadElement(lead) {
  const article = document.createElement('article');

  article.className = 'admin-lead-preview';

  const top = document.createElement('div');

  top.className = 'admin-lead-preview__top';

  const identity = document.createElement('div');

  const name = document.createElement('strong');

  name.className = 'admin-lead-preview__name';

  name.textContent = lead.name || 'Без имени';

  const service = document.createElement('span');

  service.className = 'admin-lead-preview__service';

  service.textContent = lead.service || 'Услуга не указана';

  identity.append(name, service);

  const status = document.createElement('span');

  status.className = `admin-lead-preview__status admin-lead-preview__status--${String(
    lead.status || 'NEW',
  ).toLowerCase()}`;

  status.textContent = STATUS_LABELS[lead.status] || lead.status || '—';

  top.append(identity, status);

  const bottom = document.createElement('div');

  bottom.className = 'admin-lead-preview__bottom';

  const phone = document.createElement('a');

  phone.className = 'admin-lead-preview__phone';

  phone.textContent = formatPhone(lead.phone);

  const phoneLink = makePhoneLink(lead.phone);

  if (phoneLink) {
    phone.href = phoneLink;
  }

  const date = document.createElement('time');

  date.className = 'admin-lead-preview__date';

  date.dateTime = lead.createdAt || '';

  date.textContent = formatDate(lead.createdAt);

  bottom.append(phone, date);
  article.append(top, bottom);

  return article;
}

function renderLatestLeads(items = []) {
  const list = document.querySelector('[data-dashboard-latest-leads]');

  const empty = document.querySelector('[data-dashboard-empty]');

  if (!list || !empty) return;

  list.replaceChildren();

  const hasItems = Array.isArray(items) && items.length > 0;

  list.hidden = !hasItems;
  empty.hidden = hasItems;

  if (!hasItems) return;

  const fragment = document.createDocumentFragment();

  items.forEach((lead) => {
    fragment.append(createLatestLeadElement(lead));
  });

  list.append(fragment);
}

async function loadDashboard({
  silent = false,
} = {}) {
  const refreshButton = document.querySelector(
    '[data-dashboard-refresh]',
  );

  if (!silent) {
    setDashboardMessage('');
    setDashboardLoading(true);

    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent =
        'Обновляем…';
    }
  }

  try {
    const { response, data } =
      await requestJson(
        '/admin/api/dashboard',
      );

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (response.status === 403) {
      window.location.replace(
        '/admin/requests',
      );

      return;
    }

    if (!response.ok) {
      throw new Error(
        data?.message ||
          'Не удалось загрузить dashboard',
      );
    }

    renderDashboardCounts(
      data?.leads,
    );

    renderDashboardContent(
      data?.content,
    );

    renderLatestLeads(
      data?.latestLeads,
    );
  } catch (error) {
    console.error(
      'Dashboard load error:',
      error,
    );

    if (!silent) {
      setDashboardMessage(
        'Не удалось загрузить данные панели.',
      );
    }
  } finally {
    if (!silent) {
      setDashboardLoading(false);

      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent =
          'Обновить данные';
      }
    }
  }
}

async function initDashboardPage() {
  try {
    const user =
      await getCurrentUser();

    if (!user) return;

    if (user.role !== 'OWNER') {
      window.location.replace(
        '/admin/requests',
      );

      return;
    }

    setUserData(user);
    initLogout();

    const refreshButton =
      document.querySelector(
        '[data-dashboard-refresh]',
      );

    refreshButton?.addEventListener(
      'click',
      () => {
        loadDashboard();
      },
    );

    await loadDashboard();

    startLiveRefresh(() =>
      loadDashboard({
        silent: true,
      }),
    );
  } catch (error) {
    console.error(
      'Dashboard init error:',
      error,
    );

    setDashboardMessage(
      'Не удалось открыть панель управления.',
    );

    setDashboardLoading(false);
  }
}

/* REQUESTS */

const requestsState = {
  status: '',
  search: '',
  dateFrom: '',
  dateTo: '',
  page: 1,
  limit: 10,
  totalPages: 1,
  user: null,
  activeLead: null,
};

function getRequestsElements() {
  return {
    list: document.querySelector('[data-requests-list]'),

    loading: document.querySelector('[data-requests-loading]'),

    empty: document.querySelector('[data-requests-empty]'),

    message: document.querySelector('[data-requests-message]'),

    pagination: document.querySelector('[data-requests-pagination]'),

    paginationInfo: document.querySelector('[data-requests-pagination-info]'),

    previousButton: document.querySelector('[data-requests-prev]'),

    nextButton: document.querySelector('[data-requests-next]'),

    refreshButton: document.querySelector('[data-requests-refresh]'),

    searchForm: document.querySelector('[data-requests-search-form]'),

    searchInput: document.querySelector('[data-requests-search]'),

    searchReset: document.querySelector('[data-requests-search-reset]'),

    dateForm: document.querySelector('[data-requests-date-form]'),

    dateFrom: document.querySelector('[data-requests-date-from]'),

    dateTo: document.querySelector('[data-requests-date-to]'),

    dateReset: document.querySelector('[data-requests-date-reset]'),
  };
}

function setRequestsMessage(message, type = 'error') {
  const element = document.querySelector('[data-requests-message]');

  if (!element) return;

  element.textContent = message;
  element.hidden = !message;

  element.classList.toggle(
    'admin-requests__message--success',
    type === 'success',
  );
}

function setRequestsLoading(isLoading) {
  const { list, loading, empty } = getRequestsElements();

  if (loading) {
    loading.hidden = !isLoading;
  }

  if (isLoading) {
    if (list) list.hidden = true;
    if (empty) empty.hidden = true;
  }
}

function renderRequestCounts(counts = {}) {
  document.querySelectorAll('[data-request-count]').forEach((element) => {
    const key = element.dataset.requestCount;

    element.textContent = Number(counts[key]) || 0;
  });
}

function getStatusLabel(status) {
  return STATUS_LABELS[status] || status || 'Неизвестно';
}

function createRequestCard(lead) {
  const article = document.createElement('article');

  article.className = 'admin-request-card';

  const head = document.createElement('div');
  head.className = 'admin-request-card__head';

  const identity = document.createElement('div');

  const caption = document.createElement('span');

  caption.className = 'admin-request-card__caption';

  caption.textContent = `Заявка №${lead.id}`;

  const name = document.createElement('h3');
  name.className = 'admin-request-card__name';
  name.textContent = lead.name || 'Без имени';

  identity.append(caption, name);

  const status = document.createElement('span');

  status.className = `admin-request-card__status admin-request-card__status--${String(
    lead.status || 'NEW',
  ).toLowerCase()}`;

  status.textContent = getStatusLabel(lead.status);

  head.append(identity, status);

  const body = document.createElement('div');
  body.className = 'admin-request-card__body';

  const service = document.createElement('div');
  service.className = 'admin-request-card__field';

  service.innerHTML = '<span>Услуга</span>';

  const serviceValue = document.createElement('strong');

  serviceValue.textContent = lead.service || '—';

  service.append(serviceValue);

  const phone = document.createElement('div');
  phone.className = 'admin-request-card__field';

  phone.innerHTML = '<span>Телефон</span>';

  const phoneLink = document.createElement('a');

  phoneLink.textContent = formatPhone(lead.phone);

  const telLink = makePhoneLink(lead.phone);

  if (telLink) {
    phoneLink.href = telLink;
  }

  phone.append(phoneLink);

  const date = document.createElement('div');
  date.className = 'admin-request-card__field';

  date.innerHTML = '<span>Создана</span>';

  const dateValue = document.createElement('strong');

  dateValue.textContent = formatDate(lead.createdAt);

  date.append(dateValue);

  body.append(service, phone, date);

  const footer = document.createElement('div');

  footer.className = 'admin-request-card__footer';

  const flags = document.createElement('div');

  flags.className = 'admin-request-card__flags';

  const emailFlag = document.createElement('span');

  emailFlag.className = lead.emailSent
    ? 'admin-request-card__flag admin-request-card__flag--success'
    : 'admin-request-card__flag admin-request-card__flag--warning';

  emailFlag.textContent = lead.emailSent
    ? 'Email отправлен'
    : 'Email не отправлен';

  flags.append(emailFlag);

  if (lead.internalComment) {
    const commentFlag = document.createElement('span');

    commentFlag.className = 'admin-request-card__flag';

    commentFlag.textContent = 'Есть комментарий';

    flags.append(commentFlag);
  }

  const openButton = document.createElement('button');

  openButton.className = 'admin-request-card__open';

  openButton.type = 'button';
  openButton.dataset.requestOpen = String(lead.id);

  openButton.textContent = 'Открыть';

  footer.append(flags, openButton);

  article.append(head, body, footer);

  return article;
}

function renderRequests(items = []) {
  const { list, empty } = getRequestsElements();

  if (!list || !empty) return;

  list.replaceChildren();

  const hasItems = Array.isArray(items) && items.length > 0;

  list.hidden = !hasItems;
  empty.hidden = hasItems;

  if (!hasItems) return;

  const fragment = document.createDocumentFragment();

  items.forEach((lead) => {
    fragment.append(createRequestCard(lead));
  });

  list.append(fragment);
}

function renderRequestsPagination(pagination = {}) {
  const {
    pagination: element,
    paginationInfo,
    previousButton,
    nextButton,
  } = getRequestsElements();

  if (!element || !paginationInfo || !previousButton || !nextButton) {
    return;
  }

  requestsState.page = Number(pagination.page) || 1;

  requestsState.totalPages = Number(pagination.totalPages) || 1;

  const shouldShow = Number(pagination.total) > requestsState.limit;

  element.hidden = !shouldShow;

  paginationInfo.textContent = `Страница ${requestsState.page} из ${requestsState.totalPages}`;

  previousButton.disabled = requestsState.page <= 1;

  nextButton.disabled = requestsState.page >= requestsState.totalPages;
}

function buildRequestsQuery() {
  const params = new URLSearchParams();

  params.set('page', String(requestsState.page));

  params.set('limit', String(requestsState.limit));

  if (requestsState.status) {
    params.set('status', requestsState.status);
  }

  if (requestsState.search) {
    params.set('search', requestsState.search);
  }

  if (requestsState.dateFrom) {
    params.set('dateFrom', requestsState.dateFrom);
  }

  if (requestsState.dateTo) {
    params.set('dateTo', requestsState.dateTo);
  }

  return params.toString();
}

async function loadRequests({ silent = false } = {}) {
  const { refreshButton } = getRequestsElements();

  if (!silent) {
    setRequestsMessage('');
    setRequestsLoading(true);

    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = 'Обновляем…';
    }
  }

  try {
    const query = buildRequestsQuery();

    const { response, data } = await requestJson(`/admin/api/leads?${query}`);

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok) {
      throw new Error(data?.message || 'Не удалось загрузить заявки');
    }

    renderRequestCounts(data.counts);
    renderRequests(data.items);
    renderRequestsPagination(data.pagination);
  } catch (error) {
    console.error('Requests load error:', error);

    if (!silent) {
      setRequestsMessage('Не удалось загрузить заявки.');
    }
  } finally {
    if (!silent) {
      setRequestsLoading(false);

      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = 'Обновить';
      }
    }
  }
}

function setRequestModalMessage(message, type = 'error') {
  const element = document.querySelector('[data-request-edit-message]');

  if (!element) return;

  element.textContent = message;
  element.hidden = !message;

  element.classList.toggle(
    'admin-request-modal__message--success',
    type === 'success',
  );
}

function setRequestModalLoading(isLoading) {
  const loading = document.querySelector('[data-request-modal-loading]');

  const content = document.querySelector('[data-request-modal-content]');

  if (loading) {
    loading.hidden = !isLoading;
  }

  if (content) {
    content.hidden = isLoading;
  }
}

function closeRequestModal() {
  const modal = document.querySelector('[data-request-modal]');

  if (!modal) return;

  modal.hidden = true;
  document.body.classList.remove('admin-body--modal-open');

  requestsState.activeLead = null;
  setRequestModalMessage('');
}

function renderRequestModal(lead) {
  requestsState.activeLead = lead;

  const title = document.querySelector('[data-request-modal-title]');

  const name = document.querySelector('[data-request-detail-name]');

  const phone = document.querySelector('[data-request-detail-phone]');

  const service = document.querySelector('[data-request-detail-service]');

  const date = document.querySelector('[data-request-detail-date]');

  const source = document.querySelector('[data-request-detail-source]');

  const email = document.querySelector('[data-request-detail-email]');

  const message = document.querySelector('[data-request-detail-message]');

  const status = document.querySelector('[data-request-status]');

  const internalComment = document.querySelector(
    '[data-request-internal-comment]',
  );

  const deleteButton = document.querySelector('[data-request-delete]');

  if (title) {
    title.textContent = `Заявка №${lead.id}`;
  }

  if (name) {
    name.textContent = lead.name || '—';
  }

  if (phone) {
    phone.textContent = formatPhone(lead.phone);

    phone.href = makePhoneLink(lead.phone) || '#';
  }

  if (service) {
    service.textContent = lead.service || '—';
  }

  if (date) {
    date.textContent = formatDate(lead.createdAt);
  }

  if (source) {
    source.textContent = lead.source || '—';
  }

  if (email) {
    email.textContent = lead.emailSent ? 'Отправлен' : 'Не отправлен';
  }

  if (message) {
    message.textContent = lead.message || 'Комментарий отсутствует';
  }

  if (status) {
    status.value = lead.status || 'NEW';
  }

  if (internalComment) {
    internalComment.value = lead.internalComment || '';
  }

  if (deleteButton) {
    deleteButton.hidden = requestsState.user?.role !== 'OWNER';
  }
}

async function openRequestModal(id) {
  const modal = document.querySelector('[data-request-modal]');

  if (!modal) return;

  modal.hidden = false;

  document.body.classList.add('admin-body--modal-open');

  setRequestModalMessage('');
  setRequestModalLoading(true);

  try {
    const { response, data } = await requestJson(`/admin/api/leads/${id}`);

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !data?.lead) {
      throw new Error(data?.message || 'Не удалось открыть заявку');
    }

    renderRequestModal(data.lead);
  } catch (error) {
    console.error('Request open error:', error);

    setRequestModalMessage('Не удалось загрузить заявку.');
  } finally {
    setRequestModalLoading(false);
  }
}

async function saveActiveRequest(event) {
  event.preventDefault();

  const lead = requestsState.activeLead;

  if (!lead) return;

  const status = document.querySelector('[data-request-status]');

  const internalComment = document.querySelector(
    '[data-request-internal-comment]',
  );

  const saveButton = document.querySelector('[data-request-save]');

  setRequestModalMessage('');

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = 'Сохраняем…';
  }

  try {
    const csrfToken = await getCsrfToken();

    if (!csrfToken) return;

    const { response, data } = await requestJson(
      `/admin/api/leads/${lead.id}`,
      {
        method: 'PATCH',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          status: status?.value,
          internalComment: internalComment?.value.trim() || null,
        }),
      },
    );

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !data?.lead) {
      throw new Error(data?.message || 'Не удалось обновить заявку');
    }

    renderRequestModal(data.lead);

    setRequestModalMessage('Изменения сохранены.', 'success');

    await loadRequests();
  } catch (error) {
    console.error('Request save error:', error);

    setRequestModalMessage(error.message || 'Не удалось сохранить изменения.');
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = 'Сохранить изменения';
    }
  }
}

async function deleteActiveRequest() {
  const lead = requestsState.activeLead;

  if (!lead || requestsState.user?.role !== 'OWNER') {
    return;
  }

  const confirmed = window.confirm(
    `Удалить заявку №${lead.id}? Это действие нельзя отменить.`,
  );

  if (!confirmed) return;

  const deleteButton = document.querySelector('[data-request-delete]');

  if (deleteButton) {
    deleteButton.disabled = true;
    deleteButton.textContent = 'Удаляем…';
  }

  try {
    const csrfToken = await getCsrfToken();

    if (!csrfToken) return;

    const { response, data } = await requestJson(
      `/admin/api/leads/${lead.id}`,
      {
        method: 'DELETE',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
      },
    );

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok) {
      throw new Error(data?.message || 'Не удалось удалить заявку');
    }

    closeRequestModal();

    if (requestsState.page > 1) {
      requestsState.page -= 1;
    }

    await loadRequests();

    setRequestsMessage('Заявка удалена.', 'success');
  } catch (error) {
    console.error('Request delete error:', error);

    setRequestModalMessage(error.message || 'Не удалось удалить заявку.');
  } finally {
    if (deleteButton) {
      deleteButton.disabled = false;
      deleteButton.textContent = 'Удалить заявку';
    }
  }
}

function initRequestModal() {
  document.querySelectorAll('[data-request-modal-close]').forEach((button) => {
    button.addEventListener('click', closeRequestModal);
  });

  document
    .querySelector('[data-request-edit-form]')
    ?.addEventListener('submit', saveActiveRequest);

  document
    .querySelector('[data-request-delete]')
    ?.addEventListener('click', deleteActiveRequest);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }

    const modal = document.querySelector('[data-request-modal]');

    if (modal && !modal.hidden) {
      closeRequestModal();
    }
  });
}

function initRequestsControls() {
  const elements = getRequestsElements();

  elements.refreshButton?.addEventListener('click', () => {
    loadRequests();
  });

  elements.searchForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    requestsState.search = elements.searchInput?.value.trim() || '';

    requestsState.page = 1;

    if (elements.searchReset) {
      elements.searchReset.hidden = !requestsState.search;
    }

    await loadRequests();
  });

  elements.searchReset?.addEventListener('click', async () => {
    requestsState.search = '';
    requestsState.page = 1;

    if (elements.searchInput) {
      elements.searchInput.value = '';
    }

    elements.searchReset.hidden = true;

    await loadRequests();
  });

  elements.dateForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    requestsState.dateFrom = elements.dateFrom?.value || '';

    requestsState.dateTo = elements.dateTo?.value || '';

    if (
      requestsState.dateFrom &&
      requestsState.dateTo &&
      requestsState.dateFrom > requestsState.dateTo
    ) {
      setRequestsMessage('Начальная дата не может быть позже конечной.');

      return;
    }

    requestsState.page = 1;

    if (elements.dateReset) {
      elements.dateReset.hidden =
        !requestsState.dateFrom && !requestsState.dateTo;
    }

    await loadRequests();
  });

  elements.dateReset?.addEventListener('click', async () => {
    requestsState.dateFrom = '';
    requestsState.dateTo = '';
    requestsState.page = 1;

    if (elements.dateFrom) {
      elements.dateFrom.value = '';
    }

    if (elements.dateTo) {
      elements.dateTo.value = '';
    }

    elements.dateReset.hidden = true;

    await loadRequests();
  });

  document.querySelectorAll('[data-request-filter]').forEach((button) => {
    button.addEventListener('click', async () => {
      document.querySelectorAll('[data-request-filter]').forEach((item) => {
        item.classList.remove('is-active');
      });

      button.classList.add('is-active');

      requestsState.status = button.dataset.requestFilter || '';

      requestsState.page = 1;

      await loadRequests();
    });
  });

  elements.previousButton?.addEventListener('click', async () => {
    if (requestsState.page <= 1) {
      return;
    }

    requestsState.page -= 1;
    await loadRequests();
  });

  elements.nextButton?.addEventListener('click', async () => {
    if (requestsState.page >= requestsState.totalPages) {
      return;
    }

    requestsState.page += 1;
    await loadRequests();
  });

  elements.list?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-request-open]');

    if (!button) return;

    openRequestModal(button.dataset.requestOpen);
  });
}

async function initRequestsPage() {
  try {
    const user = await getCurrentUser();

    if (!user) return;

    requestsState.user = user;

    setUserData(user);
    initLogout();
    initRequestsControls();
    initRequestModal();

    await loadRequests();

    startLiveRefresh(() =>
      loadRequests({
        silent: true,
      }),
    );
  } catch (error) {
    console.error('Requests init error:', error);

    setRequestsMessage('Не удалось открыть раздел заявок.');

    setRequestsLoading(false);
  }
}

/* STAFF */

const staffState = {
  items: [],
  activeStaff: null,
  mode: 'create',
};

function getStaffElements() {
  return {
    list: document.querySelector(
      '[data-staff-list]',
    ),

    loading: document.querySelector(
      '[data-staff-loading]',
    ),

    empty: document.querySelector(
      '[data-staff-empty]',
    ),

    message: document.querySelector(
      '[data-staff-message]',
    ),

    modal: document.querySelector(
      '[data-staff-modal]',
    ),

    form: document.querySelector(
      '[data-staff-form]',
    ),

    name: document.querySelector(
      '[data-staff-name]',
    ),

    email: document.querySelector(
      '[data-staff-email]',
    ),

    password: document.querySelector(
      '[data-staff-password]',
    ),

    active: document.querySelector(
      '[data-staff-active]',
    ),

    activeField: document.querySelector(
      '[data-staff-active-field]',
    ),

    modalCaption: document.querySelector(
      '[data-staff-modal-caption]',
    ),

    modalTitle: document.querySelector(
      '[data-staff-modal-title]',
    ),

    formMessage: document.querySelector(
      '[data-staff-form-message]',
    ),

    saveButton: document.querySelector(
      '[data-staff-save]',
    ),

    deleteButton: document.querySelector(
      '[data-staff-delete]',
    ),
  };
}

function setStaffMessage(
  text,
  type = 'error',
) {
  const element = document.querySelector(
    '[data-staff-message]',
  );

  if (!element) return;

  element.textContent = text;
  element.hidden = !text;

  element.classList.toggle(
    'admin-staff__message--success',
    type === 'success',
  );
}

function setStaffFormMessage(
  text,
  type = 'error',
) {
  const element = document.querySelector(
    '[data-staff-form-message]',
  );

  if (!element) return;

  element.textContent = text;
  element.hidden = !text;

  element.classList.toggle(
    'admin-staff-modal__message--success',
    type === 'success',
  );
}

function setStaffLoading(isLoading) {
  const {
    list,
    loading,
    empty,
  } = getStaffElements();

  if (loading) {
    loading.hidden = !isLoading;
  }

  if (isLoading) {
    if (list) list.hidden = true;
    if (empty) empty.hidden = true;
  }
}

function renderStaffCounts(counts = {}) {
  document
    .querySelectorAll('[data-staff-count]')
    .forEach((element) => {
      const key =
        element.dataset.staffCount;

      element.textContent =
        Number(counts[key]) || 0;
    });
}

function createStaffCard(staff) {
  const article =
    document.createElement('article');

  article.className =
    'admin-staff-card';

  if (!staff.isActive) {
    article.classList.add(
      'admin-staff-card--blocked',
    );
  }

  const header =
    document.createElement('div');

  header.className =
    'admin-staff-card__header';

  const identity =
    document.createElement('div');

  const role =
    document.createElement('span');

  role.className =
    'admin-staff-card__role';

  role.textContent =
    'Доступ только к заявкам';

  const name =
    document.createElement('h3');

  name.className =
    'admin-staff-card__name';

  name.textContent =
    staff.name || 'Без имени';

  const email =
    document.createElement('span');

  email.className =
    'admin-staff-card__email';

  email.textContent =
    staff.email || '—';

  identity.append(
    role,
    name,
    email,
  );

  const status =
    document.createElement('span');

  status.className = staff.isActive
    ? 'admin-staff-card__status admin-staff-card__status--active'
    : 'admin-staff-card__status admin-staff-card__status--blocked';

  status.textContent = staff.isActive
    ? 'Активен'
    : 'Заблокирован';

  header.append(identity, status);

  const details =
    document.createElement('div');

  details.className =
    'admin-staff-card__details';

  const detailItems = [
    {
      label: 'Последний вход',
      value: staff.lastLoginAt
        ? formatDate(staff.lastLoginAt)
        : 'Ещё не входил',
    },
    {
      label: 'Создан',
      value: formatDate(
        staff.createdAt,
      ),
    },
    {
      label: 'Назначено заявок',
      value: String(
        staff.assignedLeadsCount || 0,
      ),
    },
  ];

  detailItems.forEach((item) => {
    const detail =
      document.createElement('div');

    detail.className =
      'admin-staff-card__detail';

    const label =
      document.createElement('span');

    label.textContent = item.label;

    const value =
      document.createElement('strong');

    value.textContent = item.value;

    detail.append(label, value);
    details.append(detail);
  });

  const actions =
    document.createElement('div');

  actions.className =
    'admin-staff-card__actions';

  const editButton =
    document.createElement('button');

  editButton.className =
    'admin-staff-card__edit';

  editButton.type = 'button';

  editButton.dataset.staffEdit =
    String(staff.id);

  editButton.textContent =
    'Редактировать';

  const toggleButton =
    document.createElement('button');

  toggleButton.className =
    'admin-staff-card__toggle';

  toggleButton.type = 'button';

  toggleButton.dataset.staffToggle =
    String(staff.id);

  toggleButton.textContent =
    staff.isActive
      ? 'Заблокировать'
      : 'Разблокировать';

  actions.append(
    editButton,
    toggleButton,
  );

  article.append(
    header,
    details,
    actions,
  );

  return article;
}

function renderStaff(items = []) {
  const {
    list,
    empty,
  } = getStaffElements();

  if (!list || !empty) return;

  staffState.items =
    Array.isArray(items) ? items : [];

  list.replaceChildren();

  const hasItems =
    staffState.items.length > 0;

  list.hidden = !hasItems;
  empty.hidden = hasItems;

  if (!hasItems) return;

  const fragment =
    document.createDocumentFragment();

  staffState.items.forEach((staff) => {
    fragment.append(
      createStaffCard(staff),
    );
  });

  list.append(fragment);
}

async function loadStaff({
  silent = false,
} = {}) {
  if (!silent) {
    setStaffMessage('');
    setStaffLoading(true);
  }

  try {
    const { response, data } =
      await requestJson(
        '/admin/api/staff',
      );

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (response.status === 403) {
      window.location.replace(
        '/admin/requests',
      );

      return;
    }

    if (!response.ok) {
      throw new Error(
        data?.message ||
          'Не удалось загрузить сотрудников',
      );
    }

    renderStaffCounts(data.counts);
    renderStaff(data.staff);
  } catch (error) {
    console.error(
      'Staff load error:',
      error,
    );

    if (!silent) {
      setStaffMessage(
        'Не удалось загрузить сотрудников.',
      );
    }
  } finally {
    if (!silent) {
      setStaffLoading(false);
    }
  }
}

function openStaffModal(
  mode,
  staff = null,
) {
  const elements =
    getStaffElements();

  if (
    !elements.modal ||
    !elements.form
  ) {
    return;
  }

  staffState.mode = mode;
  staffState.activeStaff = staff;

  elements.form.reset();
  setStaffFormMessage('');

  const isCreate =
    mode === 'create';

  if (elements.modalCaption) {
    elements.modalCaption.textContent =
      isCreate
        ? 'Новый пользователь'
        : 'Настройки доступа';
  }

  if (elements.modalTitle) {
    elements.modalTitle.textContent =
      isCreate
        ? 'Добавить сотрудника'
        : 'Редактировать сотрудника';
  }

  if (elements.name) {
    elements.name.value =
      staff?.name || '';
  }

  if (elements.email) {
    elements.email.value =
      staff?.email || '';
  }

  if (elements.password) {
    elements.password.value = '';
    elements.password.required =
      isCreate;
  }

  if (elements.active) {
    elements.active.checked =
      staff?.isActive ?? true;
  }

  if (elements.activeField) {
    elements.activeField.hidden =
      isCreate;
  }

  if (elements.deleteButton) {
    elements.deleteButton.hidden =
      isCreate;
  }

  elements.modal.hidden = false;

  document.body.classList.add(
    'admin-body--modal-open',
  );

  window.setTimeout(() => {
    elements.name?.focus();
  }, 50);
}

function closeStaffModal() {
  const {
    modal,
    form,
  } = getStaffElements();

  if (!modal) return;

  modal.hidden = true;

  document.body.classList.remove(
    'admin-body--modal-open',
  );

  form?.reset();

  staffState.activeStaff = null;
  staffState.mode = 'create';

  setStaffFormMessage('');
}

async function saveStaff(event) {
  event.preventDefault();

  const elements =
    getStaffElements();

  if (
    !elements.form ||
    !elements.name ||
    !elements.email ||
    !elements.password
  ) {
    return;
  }

  if (
    !elements.form.checkValidity()
  ) {
    elements.form.reportValidity();
    return;
  }

  const isCreate =
    staffState.mode === 'create';

  const payload = {
    name:
      elements.name.value.trim(),

    email:
      elements.email.value
        .trim()
        .toLowerCase(),
  };

  const password =
    elements.password.value;

  if (isCreate || password) {
    payload.password = password;
  }

  if (!isCreate) {
    payload.isActive =
      Boolean(
        elements.active?.checked,
      );
  }

  if (elements.saveButton) {
    elements.saveButton.disabled = true;
    elements.saveButton.textContent =
      'Сохраняем…';
  }

  setStaffFormMessage('');

  try {
    const csrfToken =
      await getCsrfToken();

    if (!csrfToken) return;

    const url = isCreate
      ? '/admin/api/staff'
      : `/admin/api/staff/${staffState.activeStaff.id}`;

    const method =
      isCreate ? 'POST' : 'PATCH';

    const { response, data } =
      await requestJson(url, {
        method,

        headers: {
          'X-CSRF-Token':
            csrfToken,
        },

        body: JSON.stringify(payload),
      });

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (response.status === 403) {
      window.location.replace(
        '/admin/requests',
      );

      return;
    }

    if (!response.ok) {
      throw new Error(
        data?.message ||
          'Не удалось сохранить сотрудника',
      );
    }

    closeStaffModal();

    await loadStaff();

    setStaffMessage(
      isCreate
        ? 'Сотрудник создан.'
        : 'Данные сотрудника обновлены.',
      'success',
    );
  } catch (error) {
    console.error(
      'Staff save error:',
      error,
    );

    setStaffFormMessage(
      error.message ||
        'Не удалось сохранить сотрудника.',
    );
  } finally {
    if (elements.saveButton) {
      elements.saveButton.disabled = false;
      elements.saveButton.textContent =
        'Сохранить';
    }
  }
}

async function toggleStaffAccess(id) {
  const staff =
    staffState.items.find(
      (item) =>
        String(item.id) === String(id),
    );

  if (!staff) return;

  const nextActive =
    !staff.isActive;

  const actionText = nextActive
    ? 'разблокировать'
    : 'заблокировать';

  const confirmed =
    window.confirm(
      `${actionText[0].toUpperCase()}${actionText.slice(
        1,
      )} сотрудника ${staff.name}?`,
    );

  if (!confirmed) return;

  try {
    const csrfToken =
      await getCsrfToken();

    if (!csrfToken) return;

    const { response, data } =
      await requestJson(
        `/admin/api/staff/${staff.id}`,
        {
          method: 'PATCH',

          headers: {
            'X-CSRF-Token':
              csrfToken,
          },

          body: JSON.stringify({
            isActive: nextActive,
          }),
        },
      );

    if (!response.ok) {
      throw new Error(
        data?.message ||
          'Не удалось изменить доступ',
      );
    }

    await loadStaff({
      silent: true,
    });

    setStaffMessage(
      nextActive
        ? 'Сотрудник разблокирован.'
        : 'Сотрудник заблокирован. Его сессии завершены.',
      'success',
    );
  } catch (error) {
    console.error(
      'Staff toggle error:',
      error,
    );

    setStaffMessage(
      error.message ||
        'Не удалось изменить доступ.',
    );
  }
}

async function deleteStaff() {
  const staff =
    staffState.activeStaff;

  if (!staff) return;

  const confirmed =
    window.confirm(
      `Удалить сотрудника ${staff.name}? Его доступ будет окончательно закрыт.`,
    );

  if (!confirmed) return;

  const {
    deleteButton,
  } = getStaffElements();

  if (deleteButton) {
    deleteButton.disabled = true;
    deleteButton.textContent =
      'Удаляем…';
  }

  try {
    const csrfToken =
      await getCsrfToken();

    if (!csrfToken) return;

    const { response, data } =
      await requestJson(
        `/admin/api/staff/${staff.id}`,
        {
          method: 'DELETE',

          headers: {
            'X-CSRF-Token':
              csrfToken,
          },
        },
      );

    if (!response.ok) {
      throw new Error(
        data?.message ||
          'Не удалось удалить сотрудника',
      );
    }

    closeStaffModal();
    await loadStaff();

    setStaffMessage(
      'Сотрудник удалён.',
      'success',
    );
  } catch (error) {
    console.error(
      'Staff delete error:',
      error,
    );

    setStaffFormMessage(
      error.message ||
        'Не удалось удалить сотрудника.',
    );
  } finally {
    if (deleteButton) {
      deleteButton.disabled = false;
      deleteButton.textContent =
        'Удалить сотрудника';
    }
  }
}

function initStaffControls() {
  const {
    list,
    form,
    deleteButton,
  } = getStaffElements();

  document
    .querySelector(
      '[data-staff-create]',
    )
    ?.addEventListener(
      'click',
      () => {
        openStaffModal('create');
      },
    );

  document
    .querySelectorAll(
      '[data-staff-modal-close]',
    )
    .forEach((button) => {
      button.addEventListener(
        'click',
        closeStaffModal,
      );
    });

  form?.addEventListener(
    'submit',
    saveStaff,
  );

  deleteButton?.addEventListener(
    'click',
    deleteStaff,
  );

  list?.addEventListener(
    'click',
    (event) => {
      const editButton =
        event.target.closest(
          '[data-staff-edit]',
        );

      if (editButton) {
        const staff =
          staffState.items.find(
            (item) =>
              String(item.id) ===
              editButton.dataset.staffEdit,
          );

        if (staff) {
          openStaffModal(
            'edit',
            staff,
          );
        }

        return;
      }

      const toggleButton =
        event.target.closest(
          '[data-staff-toggle]',
        );

      if (toggleButton) {
        toggleStaffAccess(
          toggleButton.dataset.staffToggle,
        );
      }
    },
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') {
        return;
      }

      const modal =
        document.querySelector(
          '[data-staff-modal]',
        );

      if (modal && !modal.hidden) {
        closeStaffModal();
      }
    },
  );
}

async function initStaffPage() {
  try {
    const user =
      await getCurrentUser();

    if (!user) return;

    if (user.role !== 'OWNER') {
      window.location.replace(
        '/admin/requests',
      );

      return;
    }

    setUserData(user);
    initLogout();
    initStaffControls();

    await loadStaff();

    startLiveRefresh(() =>
      loadStaff({
        silent: true,
      }),
    );
  } catch (error) {
    console.error(
      'Staff init error:',
      error,
    );

    setStaffMessage(
      'Не удалось открыть раздел сотрудников.',
    );

    setStaffLoading(false);
  }
}

/* CATALOG */

const catalogAdminState = {
  products: [],
  categories: [],
  activeProduct: null,
  activeCategory: null,
  removeImageIds: new Set(),
};

function setAdminCatalogMessage(message, type = 'error') {
  const element = document.querySelector('[data-admin-catalog-message]');

  if (!element) return;

  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('admin-catalog__message--success', type === 'success');
}

function setAdminCatalogLoading(isLoading) {
  const loading = document.querySelector('[data-admin-catalog-loading]');
  const grid = document.querySelector('[data-admin-catalog-grid]');

  if (loading) loading.hidden = !isLoading;
  if (grid && isLoading) grid.hidden = true;
}

function formatCatalogPrice(product) {
  if (product.price === null || product.price === undefined) {
    return 'Цена по запросу';
  }

  return `${product.priceFrom ? 'от ' : ''}${new Intl.NumberFormat('ru-RU').format(product.price)} ₽`;
}

function renderAdminCatalogCounts(counts = {}) {
  document.querySelectorAll('[data-admin-catalog-count]').forEach((element) => {
    element.textContent = counts[element.dataset.adminCatalogCount] || 0;
  });
}

function createAdminCatalogCard(product) {
  const article = document.createElement('article');
  article.className = 'admin-catalog-card';
  article.classList.toggle('admin-catalog-card--hidden', !product.isActive);

  const imageWrap = document.createElement('div');
  imageWrap.className = 'admin-catalog-card__image';
  const image = product.images?.[0];

  if (image) {
    const img = document.createElement('img');
    img.src = image.path;
    img.alt = image.alt || product.name;
    imageWrap.append(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.textContent = 'AC';
    imageWrap.append(placeholder);
  }

  const state = document.createElement('span');
  state.className = product.isActive
    ? 'admin-catalog-card__state admin-catalog-card__state--active'
    : 'admin-catalog-card__state';
  state.textContent = product.isActive ? 'Опубликован' : 'Скрыт';
  imageWrap.append(state);

  const body = document.createElement('div');
  body.className = 'admin-catalog-card__body';

  const category = document.createElement('span');
  category.className = 'admin-catalog-card__category';
  category.textContent = product.category?.name || 'Без категории';

  const name = document.createElement('h3');
  name.textContent = product.name;

  const meta = document.createElement('p');
  meta.textContent = [product.brand, product.sku ? `Арт. ${product.sku}` : '']
    .filter(Boolean)
    .join(' · ') || 'Бренд и артикул не указаны';

  const price = document.createElement('strong');
  price.textContent = formatCatalogPrice(product);

  const actions = document.createElement('div');
  actions.className = 'admin-catalog-card__actions';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.textContent = 'Редактировать';
  edit.dataset.catalogProductEdit = String(product.id);

  const view = document.createElement('a');
  view.href = `/catalog/${product.slug}`;
  view.target = '_blank';
  view.rel = 'noopener';
  view.textContent = 'На сайте';

  actions.append(edit, view);
  body.append(category, name, meta, price, actions);
  article.append(imageWrap, body);

  return article;
}

function getFilteredAdminProducts() {
  const search = document.querySelector('[data-admin-catalog-search]')?.value.trim().toLowerCase() || '';
  const category = document.querySelector('[data-admin-catalog-category-filter]')?.value || '';
  const status = document.querySelector('[data-admin-catalog-status-filter]')?.value || '';

  return catalogAdminState.products.filter((product) => {
    const haystack = [product.name, product.brand, product.sku, product.category?.name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesCategory = !category || String(product.categoryId || '') === category;
    const matchesStatus =
      !status ||
      (status === 'active' && product.isActive) ||
      (status === 'hidden' && !product.isActive);

    return matchesSearch && matchesCategory && matchesStatus;
  });
}

function renderAdminProducts() {
  const grid = document.querySelector('[data-admin-catalog-grid]');
  const empty = document.querySelector('[data-admin-catalog-empty]');

  if (!grid || !empty) return;

  const products = getFilteredAdminProducts();
  grid.replaceChildren(...products.map(createAdminCatalogCard));
  grid.hidden = products.length === 0;
  empty.hidden = products.length > 0;
}

function fillAdminCategorySelects() {
  const productSelect = document.querySelector('[data-catalog-product-category]');
  const filterSelect = document.querySelector('[data-admin-catalog-category-filter]');
  const currentProductValue = productSelect?.value || '';
  const currentFilterValue = filterSelect?.value || '';

  if (productSelect) {
    productSelect.replaceChildren(new Option('Без категории', ''));
  }

  if (filterSelect) {
    filterSelect.replaceChildren(new Option('Все категории', ''));
  }

  catalogAdminState.categories.forEach((category) => {
    productSelect?.append(new Option(category.name, String(category.id)));
    filterSelect?.append(new Option(category.name, String(category.id)));
  });

  if (productSelect) productSelect.value = currentProductValue;
  if (filterSelect) filterSelect.value = currentFilterValue;
}

async function loadAdminCatalog() {
  setAdminCatalogLoading(true);
  setAdminCatalogMessage('');

  try {
    const { response, data } = await requestJson('/admin/api/catalog');

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok) {
      throw new Error(data?.message || 'Не удалось загрузить каталог');
    }

    catalogAdminState.products = data.products || [];
    catalogAdminState.categories = data.categories || [];
    renderAdminCatalogCounts(data.counts);
    fillAdminCategorySelects();
    renderAdminProducts();
    renderAdminCategoryList();
  } catch (error) {
    setAdminCatalogMessage(error.message || 'Не удалось загрузить каталог');
  } finally {
    setAdminCatalogLoading(false);
  }
}

function setProductModalMessage(message, type = 'error') {
  const element = document.querySelector('[data-catalog-product-message]');
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('admin-catalog-modal__message--success', type === 'success');
}

function renderExistingProductImages(product) {
  const container = document.querySelector('[data-catalog-product-existing-images]');
  if (!container) return;

  container.replaceChildren();
  const images = product?.images || [];
  container.hidden = images.length === 0;

  images.forEach((image) => {
    const item = document.createElement('div');
    item.className = 'admin-catalog-modal__image';
    const img = document.createElement('img');
    img.src = image.path;
    img.alt = image.alt || product.name;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-catalog-modal__image-remove';
    button.textContent = '×';
    button.title = 'Удалить фотографию';
    button.setAttribute('aria-label', `Удалить фотографию ${image.alt || product.name}`);
    button.addEventListener('click', () => {
      catalogAdminState.removeImageIds.add(image.id);
      item.classList.add('admin-catalog-modal__image--removed');

      window.setTimeout(() => {
        item.remove();

        if (!container.children.length) {
          container.hidden = true;
        }
      }, 160);
    });
    item.append(img, button);
    container.append(item);
  });
}

function openProductModal(product = null) {
  const modal = document.querySelector('[data-catalog-product-modal]');
  const form = document.querySelector('[data-catalog-product-form]');
  if (!modal || !form) return;

  catalogAdminState.activeProduct = product;
  catalogAdminState.removeImageIds.clear();
  form.reset();
  document.querySelector('[data-catalog-product-active]').checked = product?.isActive ?? true;
  document.querySelector('[data-catalog-product-price-from]').checked = product?.priceFrom ?? false;
  document.querySelector('[data-catalog-product-name]').value = product?.name || '';
  document.querySelector('[data-catalog-product-category]').value = product?.categoryId || '';
  document.querySelector('[data-catalog-product-brand]').value = product?.brand || '';
  document.querySelector('[data-catalog-product-sku]').value = product?.sku || '';
  document.querySelector('[data-catalog-product-slug]').value = product?.slug || '';
  document.querySelector('[data-catalog-product-price]').value = product?.price ?? '';
  document.querySelector('[data-catalog-product-order]').value = product?.sortOrder ?? 0;
  document.querySelector('[data-catalog-product-short]').value = product?.shortDescription || '';
  document.querySelector('[data-catalog-product-description]').value = product?.description || '';
  document.querySelector('[data-catalog-product-specifications]').value = product?.specifications || '';
  document.querySelector('[data-catalog-product-caption]').textContent = product ? 'Редактирование товара' : 'Новый товар';
  document.querySelector('[data-catalog-product-title]').textContent = product ? product.name : 'Добавить товар';
  document.querySelector('[data-catalog-product-delete]').hidden = !product;
  renderExistingProductImages(product);
  setProductModalMessage('');
  modal.hidden = false;
  document.body.classList.add('admin-body--modal-open');
}

function closeProductModal() {
  const modal = document.querySelector('[data-catalog-product-modal]');
  if (modal) modal.hidden = true;
  catalogAdminState.activeProduct = null;
  catalogAdminState.removeImageIds.clear();
  document.body.classList.remove('admin-body--modal-open');
}

async function saveAdminProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const product = catalogAdminState.activeProduct;
  const submit = document.querySelector('[data-catalog-product-save]');
  setProductModalMessage('');
  submit.disabled = true;
  submit.textContent = 'Сохраняем…';

  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) return;
    const formData = new FormData(form);
    formData.set('priceFrom', String(document.querySelector('[data-catalog-product-price-from]').checked));
    formData.set('isActive', String(document.querySelector('[data-catalog-product-active]').checked));
    formData.set('removeImageIds', JSON.stringify([...catalogAdminState.removeImageIds]));
    const url = product ? `/admin/api/catalog/products/${product.id}` : '/admin/api/catalog/products';
    const { response, data } = await requestFormData(url, formData, {
      method: product ? 'PATCH' : 'POST',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
    });

    if (!response.ok) {
      throw new Error(data?.message || 'Не удалось сохранить товар');
    }

    setProductModalMessage('Товар сохранён', 'success');
    await loadAdminCatalog();
    window.setTimeout(closeProductModal, 500);
  } catch (error) {
    setProductModalMessage(error.message || 'Не удалось сохранить товар');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Сохранить товар';
  }
}

async function deleteAdminProduct() {
  const product = catalogAdminState.activeProduct;
  if (!product || !window.confirm(`Удалить товар «${product.name}»? Это действие нельзя отменить.`)) return;

  const button = document.querySelector('[data-catalog-product-delete]');
  button.disabled = true;

  try {
    const csrfToken = await getCsrfToken();
    const { response, data } = await requestJson(`/admin/api/catalog/products/${product.id}`, {
      method: 'DELETE',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
    });

    if (!response.ok) throw new Error(data?.message || 'Не удалось удалить товар');
    closeProductModal();
    await loadAdminCatalog();
    setAdminCatalogMessage('Товар удалён', 'success');
  } catch (error) {
    setProductModalMessage(error.message || 'Не удалось удалить товар');
  } finally {
    button.disabled = false;
  }
}

function setCategoryMessage(message, type = 'error') {
  const element = document.querySelector('[data-catalog-category-message]');
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('admin-category-manager__message--success', type === 'success');
}

function resetCategoryForm() {
  catalogAdminState.activeCategory = null;
  const form = document.querySelector('[data-catalog-category-form]');
  form?.reset();
  document.querySelector('[data-catalog-category-order]').value = 0;
  document.querySelector('[data-catalog-category-active]').checked = true;
  document.querySelector('[data-catalog-category-form-title]').textContent = 'Новая категория';
  document.querySelector('[data-catalog-category-delete]').hidden = true;
  setCategoryMessage('');
}

function editCategory(category) {
  catalogAdminState.activeCategory = category;
  document.querySelector('[data-catalog-category-name]').value = category.name || '';
  document.querySelector('[data-catalog-category-slug]').value = category.slug || '';
  document.querySelector('[data-catalog-category-description]').value = category.description || '';
  document.querySelector('[data-catalog-category-order]').value = category.sortOrder || 0;
  document.querySelector('[data-catalog-category-active]').checked = category.isActive;
  document.querySelector('[data-catalog-category-form-title]').textContent = `Редактирование: ${category.name}`;
  document.querySelector('[data-catalog-category-delete]').hidden = false;
  setCategoryMessage('');
}

function renderAdminCategoryList() {
  const container = document.querySelector('[data-catalog-category-list]');
  if (!container) return;
  container.replaceChildren();

  catalogAdminState.categories.forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-category-manager__item';
    const name = document.createElement('strong');
    name.textContent = category.name;
    const detail = document.createElement('span');
    detail.textContent = `${category.productsCount || 0} товаров · ${category.isActive ? 'опубликована' : 'скрыта'}`;
    button.append(name, detail);
    button.addEventListener('click', () => editCategory(category));
    container.append(button);
  });
}

function openCategoryModal() {
  const modal = document.querySelector('[data-catalog-category-modal]');
  resetCategoryForm();
  renderAdminCategoryList();
  if (modal) modal.hidden = false;
  document.body.classList.add('admin-body--modal-open');
}

function closeCategoryModal() {
  const modal = document.querySelector('[data-catalog-category-modal]');
  if (modal) modal.hidden = true;
  resetCategoryForm();
  document.body.classList.remove('admin-body--modal-open');
}

async function saveAdminCategory(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const category = catalogAdminState.activeCategory;
  const submit = document.querySelector('[data-catalog-category-save]');
  submit.disabled = true;
  setCategoryMessage('');

  try {
    const csrfToken = await getCsrfToken();
    const payload = {
      name: document.querySelector('[data-catalog-category-name]').value.trim(),
      slug: document.querySelector('[data-catalog-category-slug]').value.trim(),
      description: document.querySelector('[data-catalog-category-description]').value.trim(),
      sortOrder: Number(document.querySelector('[data-catalog-category-order]').value || 0),
      isActive: document.querySelector('[data-catalog-category-active]').checked,
    };
    const url = category ? `/admin/api/catalog/categories/${category.id}` : '/admin/api/catalog/categories';
    const { response, data } = await requestJson(url, {
      method: category ? 'PATCH' : 'POST',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(data?.message || 'Не удалось сохранить категорию');
    await loadAdminCatalog();
    resetCategoryForm();
    setCategoryMessage('Категория сохранена', 'success');
  } catch (error) {
    setCategoryMessage(error.message || 'Не удалось сохранить категорию');
  } finally {
    submit.disabled = false;
  }
}

async function deleteAdminCategory() {
  const category = catalogAdminState.activeCategory;
  if (!category || !window.confirm(`Удалить категорию «${category.name}»? Товары останутся без категории.`)) return;

  const button = document.querySelector('[data-catalog-category-delete]');
  button.disabled = true;

  try {
    const csrfToken = await getCsrfToken();
    const { response, data } = await requestJson(`/admin/api/catalog/categories/${category.id}`, {
      method: 'DELETE',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
    });
    if (!response.ok) throw new Error(data?.message || 'Не удалось удалить категорию');
    await loadAdminCatalog();
    resetCategoryForm();
    setCategoryMessage('Категория удалена', 'success');
  } catch (error) {
    setCategoryMessage(error.message || 'Не удалось удалить категорию');
  } finally {
    button.disabled = false;
  }
}

function initAdminCatalogControls() {
  document.querySelector('[data-catalog-product-create]')?.addEventListener('click', () => openProductModal());
  document.querySelectorAll('[data-catalog-product-close]').forEach((button) => button.addEventListener('click', closeProductModal));
  document.querySelector('[data-catalog-product-form]')?.addEventListener('submit', saveAdminProduct);
  document.querySelector('[data-catalog-product-delete]')?.addEventListener('click', deleteAdminProduct);
  document.querySelector('[data-catalog-category-open]')?.addEventListener('click', openCategoryModal);
  document.querySelectorAll('[data-catalog-category-close]').forEach((button) => button.addEventListener('click', closeCategoryModal));
  document.querySelector('[data-catalog-category-form]')?.addEventListener('submit', saveAdminCategory);
  document.querySelector('[data-catalog-category-reset]')?.addEventListener('click', resetCategoryForm);
  document.querySelector('[data-catalog-category-delete]')?.addEventListener('click', deleteAdminCategory);

  document.querySelector('[data-admin-catalog-grid]')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-catalog-product-edit]');
    if (!button) return;
    const product = catalogAdminState.products.find((item) => item.id === Number(button.dataset.catalogProductEdit));
    if (product) openProductModal(product);
  });

  ['[data-admin-catalog-search]', '[data-admin-catalog-category-filter]', '[data-admin-catalog-status-filter]'].forEach((selector) => {
    const element = document.querySelector(selector);
    element?.addEventListener(element.matches('input') ? 'input' : 'change', renderAdminProducts);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!document.querySelector('[data-catalog-product-modal]')?.hidden) closeProductModal();
    if (!document.querySelector('[data-catalog-category-modal]')?.hidden) closeCategoryModal();
  });
}

async function initAdminCatalogPage() {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    if (user.role !== 'OWNER') {
      window.location.replace('/admin/requests');
      return;
    }
    setUserData(user);
    initLogout();
    initAdminCatalogControls();
    await loadAdminCatalog();
  } catch (error) {
    console.error('Catalog init error:', error);
    setAdminCatalogMessage('Не удалось открыть каталог');
    setAdminCatalogLoading(false);
  }
}

if (adminPage === 'login') {
  initLoginPage();
}

if (adminPage === 'dashboard') {
  initDashboardPage();
}

if (adminPage === 'requests') {
  initRequestsPage();
}

if (adminPage === 'staff') {
  initStaffPage();
}

if (adminPage === 'catalog') {
  initAdminCatalogPage();
}
