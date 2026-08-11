const catalogParams = new URLSearchParams(window.location.search);

const catalogState = {
  category: catalogParams.get('category') || '',
  search: catalogParams.get('search') || '',
  brand: catalogParams.get('brand') || '',
  priceMin: catalogParams.get('priceMin') || '',
  priceMax: catalogParams.get('priceMax') || '',
  sort: catalogParams.get('sort') || 'default',
  page: Number(catalogParams.get('page')) || 1,
  totalPages: 1,
  categories: [],
  products: [],
};

const catalogPageSize = 8;

function setCatalogStatus(message, type = 'loading') {
  const element = document.querySelector('[data-catalog-status]');

  if (!element) return;

  element.textContent = message;
  element.hidden = !message;
  element.dataset.state = type;
}

function updateCatalogUrl() {
  const params = new URLSearchParams();

  if (catalogState.category) params.set('category', catalogState.category);
  if (catalogState.search) params.set('search', catalogState.search);
  if (catalogState.brand) params.set('brand', catalogState.brand);
  if (catalogState.priceMin) params.set('priceMin', catalogState.priceMin);
  if (catalogState.priceMax) params.set('priceMax', catalogState.priceMax);
  if (catalogState.sort !== 'default') params.set('sort', catalogState.sort);
  if (catalogState.page > 1) params.set('page', String(catalogState.page));

  const query = params.toString();
  window.history.replaceState(null, '', query ? `/catalog?${query}` : '/catalog');
}

function renderCategories(categories) {
  const navigation = document.querySelector('[data-catalog-categories]');
  const select = document.querySelector('[data-catalog-category-select]');

  if (navigation) {
    navigation.replaceChildren();

    const allButton = document.createElement('button');
    allButton.type = 'button';
    allButton.className = 'catalog-category-nav__button';
    allButton.textContent = 'Все товары';
    allButton.classList.toggle('catalog-category-nav__button--active', !catalogState.category);
    allButton.addEventListener('click', () => selectCategory(''));
    navigation.append(allButton);

    categories.forEach((category) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'catalog-category-nav__button';
      button.textContent = category.name;
      button.classList.toggle(
        'catalog-category-nav__button--active',
        catalogState.category === category.slug,
      );
      button.addEventListener('click', () => selectCategory(category.slug));
      navigation.append(button);
    });
  }

  if (select) {
    select.replaceChildren(new Option('Все категории', ''));
    categories.forEach((category) => {
      select.append(new Option(category.name, category.slug));
    });
    select.value = catalogState.category;
  }

  const heading = document.querySelector('[data-catalog-heading]');
  const currentCategory = categories.find((category) => category.slug === catalogState.category);
  if (heading) heading.textContent = currentCategory?.name || 'Все товары';
}

function renderBrandOptions(products) {
  const select = document.querySelector('[data-catalog-brand]');
  if (!select) return;

  const brands = [...new Set(products.map((product) => product.brand?.trim()).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second, 'ru'));

  select.replaceChildren(new Option('Все бренды', ''));
  brands.forEach((brand) => select.append(new Option(brand, brand)));
  select.value = brands.includes(catalogState.brand) ? catalogState.brand : '';

  if (catalogState.brand && !brands.includes(catalogState.brand)) {
    catalogState.brand = '';
  }
}

function configurePriceInputs(products) {
  const prices = products
    .map((product) => Number(product.price))
    .filter((price) => Number.isFinite(price));
  const minInput = document.querySelector('[data-catalog-price-min]');
  const maxInput = document.querySelector('[data-catalog-price-max]');

  if (!minInput || !maxInput || prices.length === 0) return;

  minInput.placeholder = new Intl.NumberFormat('ru-RU').format(Math.min(...prices));
  maxInput.placeholder = new Intl.NumberFormat('ru-RU').format(Math.max(...prices));
  minInput.value = catalogState.priceMin;
  maxInput.value = catalogState.priceMax;
}

function getFilteredProducts() {
  const normalizedSearch = catalogState.search.toLocaleLowerCase('ru');
  const minPrice = catalogState.priceMin === '' ? null : Number(catalogState.priceMin);
  const maxPrice = catalogState.priceMax === '' ? null : Number(catalogState.priceMax);

  const filtered = catalogState.products.filter((product) => {
    if (catalogState.category && product.category?.slug !== catalogState.category) return false;
    if (catalogState.brand && product.brand !== catalogState.brand) return false;

    const price = product.price === null || product.price === undefined ? null : Number(product.price);
    if (minPrice !== null && (price === null || price < minPrice)) return false;
    if (maxPrice !== null && (price === null || price > maxPrice)) return false;

    if (normalizedSearch) {
      const haystack = [
        product.name,
        product.sku,
        product.brand,
        product.shortDescription,
        product.category?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('ru');

      if (!haystack.includes(normalizedSearch)) return false;
    }

    return true;
  });

  if (catalogState.sort === 'price-asc') {
    filtered.sort((first, second) => (first.price ?? Infinity) - (second.price ?? Infinity));
  } else if (catalogState.sort === 'price-desc') {
    filtered.sort((first, second) => (second.price ?? -Infinity) - (first.price ?? -Infinity));
  } else if (catalogState.sort === 'name') {
    filtered.sort((first, second) => first.name.localeCompare(second.name, 'ru'));
  } else {
    filtered.sort((first, second) => first.catalogIndex - second.catalogIndex);
  }

  return filtered;
}

function renderProducts(items) {
  const grid = document.querySelector('[data-catalog-grid]');
  const empty = document.querySelector('[data-catalog-empty]');

  if (!grid || !empty) return;

  grid.replaceChildren();
  empty.hidden = items.length > 0;

  items.forEach((product) => {
    grid.append(window.AutoCatCatalog.createProductCard(product));
  });
}

function renderPagination(totalItems) {
  const container = document.querySelector('[data-catalog-pagination]');
  const info = document.querySelector('[data-catalog-page-info]');
  const previous = document.querySelector('[data-catalog-page-prev]');
  const next = document.querySelector('[data-catalog-page-next]');

  catalogState.totalPages = Math.max(1, Math.ceil(totalItems / catalogPageSize));
  catalogState.page = Math.min(catalogState.page, catalogState.totalPages);

  if (!container || !info || !previous || !next) return;

  container.hidden = catalogState.totalPages <= 1;
  info.textContent = `${catalogState.page} / ${catalogState.totalPages}`;
  previous.disabled = catalogState.page <= 1;
  next.disabled = catalogState.page >= catalogState.totalPages;
}

function applyCatalogFilters() {
  const filtered = getFilteredProducts();
  renderPagination(filtered.length);

  const start = (catalogState.page - 1) * catalogPageSize;
  renderProducts(filtered.slice(start, start + catalogPageSize));
  renderCategories(catalogState.categories);

  const sort = document.querySelector('[data-catalog-sort]');
  if (sort) sort.value = catalogState.sort;

  updateCatalogUrl();
}

function selectCategory(category) {
  catalogState.category = category;
  catalogState.page = 1;
  applyCatalogFilters();
}

async function fetchAllProducts() {
  const products = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await fetch(`/api/catalog/products?page=${page}&limit=24`);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || 'Не удалось открыть каталог');
    }

    products.push(...(data.items || []));
    totalPages = data.pagination?.totalPages || 1;
    page += 1;
  } while (page <= totalPages);

  return products;
}

async function loadCatalog() {
  setCatalogStatus('Загружаем товары…');

  try {
    const [categoriesResponse, products] = await Promise.all([
      fetch('/api/catalog/categories'),
      fetchAllProducts(),
    ]);
    const categoriesData = await categoriesResponse.json().catch(() => ({}));

    if (!categoriesResponse.ok) {
      throw new Error(categoriesData.message || 'Не удалось открыть категории');
    }

    catalogState.categories = categoriesData.categories || [];
    catalogState.products = products.map((product, catalogIndex) => ({
      ...product,
      catalogIndex,
    }));

    if (
      catalogState.category &&
      !catalogState.categories.some((category) => category.slug === catalogState.category)
    ) {
      catalogState.category = '';
    }

    renderCategories(catalogState.categories);
    renderBrandOptions(catalogState.products);
    configurePriceInputs(catalogState.products);
    applyCatalogFilters();
    setCatalogStatus('');
  } catch (error) {
    setCatalogStatus(error.message || 'Каталог временно недоступен', 'error');
  }
}

function initCatalogControls() {
  const searchForm = document.querySelector('[data-catalog-search-form]');
  const searchInput = document.querySelector('[data-catalog-search]');
  const categorySelect = document.querySelector('[data-catalog-category-select]');
  const brandSelect = document.querySelector('[data-catalog-brand]');
  const minInput = document.querySelector('[data-catalog-price-min]');
  const maxInput = document.querySelector('[data-catalog-price-max]');
  const sortSelect = document.querySelector('[data-catalog-sort]');

  if (searchInput) searchInput.value = catalogState.search;
  if (minInput) minInput.value = catalogState.priceMin;
  if (maxInput) maxInput.value = catalogState.priceMax;
  if (sortSelect) sortSelect.value = catalogState.sort;

  searchForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    catalogState.search = searchInput?.value.trim() || '';
    catalogState.page = 1;
    applyCatalogFilters();
  });

  categorySelect?.addEventListener('change', () => {
    selectCategory(categorySelect.value);
  });

  brandSelect?.addEventListener('change', () => {
    catalogState.brand = brandSelect.value;
    catalogState.page = 1;
    applyCatalogFilters();
  });

  [minInput, maxInput].forEach((input) => {
    input?.addEventListener('change', () => {
      catalogState.priceMin = minInput?.value.trim() || '';
      catalogState.priceMax = maxInput?.value.trim() || '';
      catalogState.page = 1;
      applyCatalogFilters();
    });
  });

  sortSelect?.addEventListener('change', () => {
    catalogState.sort = sortSelect.value;
    catalogState.page = 1;
    applyCatalogFilters();
  });

  document.querySelector('[data-catalog-search-reset]')?.addEventListener('click', () => {
    catalogState.category = '';
    catalogState.search = '';
    catalogState.brand = '';
    catalogState.priceMin = '';
    catalogState.priceMax = '';
    catalogState.sort = 'default';
    catalogState.page = 1;

    if (searchInput) searchInput.value = '';
    if (brandSelect) brandSelect.value = '';
    if (minInput) minInput.value = '';
    if (maxInput) maxInput.value = '';
    if (sortSelect) sortSelect.value = 'default';

    applyCatalogFilters();
  });

  document.querySelector('[data-catalog-page-prev]')?.addEventListener('click', () => {
    if (catalogState.page <= 1) return;
    catalogState.page -= 1;
    applyCatalogFilters();
    document.querySelector('.catalog-products')?.scrollIntoView({ behavior: 'smooth' });
  });

  document.querySelector('[data-catalog-page-next]')?.addEventListener('click', () => {
    if (catalogState.page >= catalogState.totalPages) return;
    catalogState.page += 1;
    applyCatalogFilters();
    document.querySelector('.catalog-products')?.scrollIntoView({ behavior: 'smooth' });
  });
}

window.AutoCatCatalog.initInquiry();
initCatalogControls();
loadCatalog();
