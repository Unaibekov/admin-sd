(function () {
  const initBatchTabs = (root = document) => {
    const batchTabs = root.querySelector('.batch-tabs');
    const batchPanels = Array.from(root.querySelectorAll('.batch-tab-panel'));
    if (!batchTabs || !batchPanels.length || batchTabs.dataset.batchTabsReady === '1') return;
    batchTabs.dataset.batchTabsReady = '1';
    const getBatchTabId = (tab) => {
      if (!tab) return '';
      const explicitTab = tab.dataset.tab || '';
      if (explicitTab) return explicitTab;
      try {
        return new URL(tab.getAttribute('href') || '', window.location.href).hash.slice(1);
      } catch (error) {
        return '';
      }
    };
    const activateBatchTab = (id) => {
      batchTabs.querySelectorAll('a').forEach((tab) => {
        tab.classList.toggle('active', getBatchTabId(tab) === id);
      });
      batchPanels.forEach((panel) => panel.classList.toggle('active', panel.id === id));
    };
    batchTabs.querySelectorAll('a').forEach((tab) => {
      tab.addEventListener('click', (event) => {
        event.preventDefault();
        const tabId = getBatchTabId(tab);
        if (!tabId) {
          window.location.href = tab.href;
          return;
        }
        if (window.history && window.history.replaceState) {
          window.history.replaceState(window.history.state, '', tab.href);
        }
        activateBatchTab(tabId);
      });
    });
    const batchParams = new URLSearchParams(window.location.search);
    const requestedEventId = batchParams.get('eventId');
    const requestedTab = batchParams.get('tab');
    const hashTab = window.location.hash ? window.location.hash.slice(1) : '';
    const initialTab = requestedEventId ? 'journal' : requestedTab || hashTab || 'journal';
    activateBatchTab(['passport', 'journal'].includes(initialTab) ? initialTab : 'journal');

    if (requestedEventId) {
      const targetEvent = Array.from(document.querySelectorAll('[data-event-id]'))
        .find((event) => event.dataset.eventId === requestedEventId);
      if (targetEvent) {
        // Let the browser finish its native #journal anchor jump before centering the event.
        window.setTimeout(() => {
          targetEvent.scrollIntoView({ behavior: 'auto', block: 'center' });
          targetEvent.classList.add('batch-event-highlight');
          window.setTimeout(() => targetEvent.classList.remove('batch-event-highlight'), 2500);
        }, 50);
      }
    }
  };

  initBatchTabs();

  const dashboardRoot = document.querySelector('[data-dashboard-page]');
  if (dashboardRoot && window.fetch && window.DOMParser && window.history) {
    let dashboardRequest = null;

    const loadDashboardPeriod = async (href, push = true) => {
      if (dashboardRequest) dashboardRequest.abort();
      const request = new AbortController();
      dashboardRequest = request;
      dashboardRoot.classList.add('is-loading');
      dashboardRoot.setAttribute('aria-busy', 'true');

      try {
        const response = await fetch(href, {
          headers: { 'X-Requested-With': 'fetch' },
          signal: request.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const html = await response.text();
        const nextDocument = new DOMParser().parseFromString(html, 'text/html');
        const currentShell = dashboardRoot.querySelector('.dashboard-shell');
        const nextShell = nextDocument.querySelector('[data-dashboard-page] .dashboard-shell');
        if (!currentShell || !nextShell) throw new Error('Missing dashboard shell');

        currentShell.replaceWith(nextShell);
        if (push) window.history.pushState({ dashboardPeriod: true }, '', href);
      } catch (error) {
        if (error.name !== 'AbortError') window.location.href = href;
      } finally {
        if (dashboardRequest === request) {
          dashboardRequest = null;
          dashboardRoot.classList.remove('is-loading');
          dashboardRoot.removeAttribute('aria-busy');
        }
      }
    };

    dashboardRoot.addEventListener('click', (event) => {
      const link = event.target.closest('.dashboard-period-switcher a');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (link.href === window.location.href) return;
      loadDashboardPeriod(link.href);
    });

    window.addEventListener('popstate', () => {
      if (window.location.pathname === '/') loadDashboardPeriod(window.location.href, false);
    });
  }

  const problemsRoot = document.querySelector('[data-problems-page]');
  if (problemsRoot && window.fetch && window.DOMParser && window.history) {
    let problemsRequest = null;

    const loadProblemsPage = async (href, push = true) => {
      if (problemsRequest) problemsRequest.abort();
      const request = new AbortController();
      problemsRequest = request;
      problemsRoot.classList.add('is-loading');
      problemsRoot.setAttribute('aria-busy', 'true');

      try {
        const response = await fetch(href, {
          headers: { 'X-Requested-With': 'fetch' },
          signal: request.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const html = await response.text();
        const nextDocument = new DOMParser().parseFromString(html, 'text/html');
        const currentShell = problemsRoot.querySelector('.problems-page');
        const nextShell = nextDocument.querySelector('[data-problems-page] .problems-page');
        if (!currentShell || !nextShell) throw new Error('Missing problems shell');

        currentShell.replaceWith(nextShell);
        if (push) window.history.pushState({ problemsPage: true }, '', href);
      } catch (error) {
        if (error.name !== 'AbortError') window.location.href = href;
      } finally {
        if (problemsRequest === request) {
          problemsRequest = null;
          problemsRoot.classList.remove('is-loading');
          problemsRoot.removeAttribute('aria-busy');
        }
      }
    };

    problemsRoot.addEventListener('submit', (event) => {
      const form = event.target.closest('.problems-filters-form');
      if (!form) return;
      event.preventDefault();
      const action = form.getAttribute('action') || window.location.pathname;
      const url = new URL(action, window.location.href);
      const formData = new FormData(form);
      url.search = new URLSearchParams(formData).toString();
      loadProblemsPage(url.toString());
    });

    window.addEventListener('popstate', () => {
      if (window.location.pathname === '/problems') loadProblemsPage(window.location.href, false);
    });
  }

  const batchesFilters = Array.from(document.querySelectorAll('[data-batches-filter]'));
  if (batchesFilters.length) {
    const close = (filter) => {
      const toggle = filter.querySelector('[data-batches-filter-toggle]');
      const menu = filter.querySelector('[data-batches-filter-menu]');
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    };
    batchesFilters.forEach((filter) => {
      const toggle = filter.querySelector('[data-batches-filter-toggle]');
      const menu = filter.querySelector('[data-batches-filter-menu]');
      toggle.addEventListener('click', () => {
        const willOpen = menu.hidden;
        batchesFilters.forEach(close);
        menu.hidden = !willOpen;
        toggle.setAttribute('aria-expanded', String(willOpen));
      });
    });
    document.addEventListener('click', (event) => {
      if (!batchesFilters.some((filter) => filter.contains(event.target))) batchesFilters.forEach(close);
    });
  }

  const selectedBatch = document.querySelector('[data-selected-batch]');
  if (selectedBatch) {
    window.setTimeout(() => selectedBatch.scrollIntoView({ behavior: 'auto', block: 'center' }), 0);
  }

  const batchesList = document.querySelector('.batches-list');
  if (batchesList && window.fetch && window.DOMParser && window.history) {
    const normalizeStageUrl = (href) => {
      const url = new URL(href, window.location.href);
      return `${url.pathname}${url.search}`;
    };

    const setActiveBatchCard = (href) => {
      const target = normalizeStageUrl(href);
      document.querySelectorAll('.batch-list-card').forEach((card) => {
        const isActive = normalizeStageUrl(card.href) === target;
        card.classList.toggle('active', isActive);
        if (isActive) card.setAttribute('data-selected-batch', '');
        else card.removeAttribute('data-selected-batch');
      });
    };

    const loadBatchDetail = async (href, push = true) => {
      const currentShell = document.querySelector('.batch-detail-shell');
      if (!currentShell) {
        window.location.href = href;
        return;
      }

      currentShell.classList.add('is-loading');
      try {
        const response = await fetch(href, { headers: { 'X-Requested-With': 'fetch' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const nextDocument = new DOMParser().parseFromString(html, 'text/html');
        const nextShell = nextDocument.querySelector('.batch-detail-shell');
        if (!nextShell) throw new Error('Missing batch detail shell');

        currentShell.replaceWith(nextShell);
        if (push) window.history.pushState({ stagesBatch: true }, '', href);
        initBatchTabs(nextShell);
        setActiveBatchCard(href);
      } catch (error) {
        window.location.href = href;
      }
    };

    batchesList.addEventListener('click', (event) => {
      const link = event.target.closest('a.batch-list-card');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      loadBatchDetail(link.href);
    });

    window.addEventListener('popstate', () => {
      if (window.location.pathname === '/stages') loadBatchDetail(window.location.href, false);
    });
  }

  const uploadForm = document.querySelector('[data-upload-form]');
  if (uploadForm) {
    const uploadInput = uploadForm.querySelector('[data-upload-input]');
    const uploadTrigger = uploadForm.querySelector('[data-upload-trigger]');
    const uploadLoader = document.querySelector('[data-upload-loader]');
    const showUploadLoader = () => {
      if (uploadLoader) uploadLoader.hidden = false;
      if (uploadTrigger) {
        uploadTrigger.disabled = true;
        uploadTrigger.textContent = 'Р—Р°РіСЂСѓР¶Р°РµРј...';
      }
    };

    if (uploadInput && uploadTrigger) {
      uploadTrigger.addEventListener('click', () => {
        uploadInput.click();
      });

      uploadInput.addEventListener('change', () => {
        if (uploadInput.files && uploadInput.files.length > 0) {
          showUploadLoader();
          uploadForm.requestSubmit();
        }
      });
    }

    uploadForm.addEventListener('submit', showUploadLoader);
  }

  const tabRoot = document.querySelector('[data-dashboard-tabs]');
  if (tabRoot) {
    const tabButtons = Array.from(tabRoot.querySelectorAll('[data-dashboard-tab-button]'));
    const tabPanels = Array.from(tabRoot.querySelectorAll('[data-dashboard-tab-panel]'));

    const activateTab = (tabName) => {
      tabButtons.forEach((button) => {
        const isActive = button.dataset.dashboardTabButton === tabName;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', String(isActive));
      });

      tabPanels.forEach((panel) => {
        const isActive = panel.dataset.dashboardTabPanel === tabName;
        panel.classList.toggle('active', isActive);
        panel.hidden = !isActive;
      });
    };

    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        activateTab(button.dataset.dashboardTabButton);
      });
    });

    const initialTab = tabButtons.find((button) => button.classList.contains('active'))?.dataset.dashboardTabButton || tabButtons[0]?.dataset.dashboardTabButton;
    if (initialTab) {
      activateTab(initialTab);
    }
  }

  const scrollTopButton = document.querySelector('[data-scroll-top]');
  if (scrollTopButton) {
    const toggleScrollTopButton = () => {
      const shouldShow = window.scrollY > 480;
      scrollTopButton.hidden = !shouldShow;
    };

    scrollTopButton.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    window.addEventListener('scroll', toggleScrollTopButton, { passive: true });
    toggleScrollTopButton();
  }

  const journalRoot = document.querySelector('[data-journal-page]');
  if (journalRoot) {
    const searchInput = journalRoot.querySelector('[data-journal-search]');
    const stageButtons = Array.from(journalRoot.querySelectorAll('[data-journal-stage]'));
    const employeeButtons = Array.from(journalRoot.querySelectorAll('[data-journal-employee]'));
    const tabButtons = Array.from(journalRoot.querySelectorAll('[data-journal-tab]'));
    const tabStrip = journalRoot.querySelector('[data-journal-tab-strip]');
    const employeeFilter = journalRoot.querySelector('[data-journal-employee-filter]');
    const employeeFilterToggle = journalRoot.querySelector('[data-journal-employee-filter-toggle]');
    const employeeFilterMenu = journalRoot.querySelector('[data-journal-employee-filter-menu]');
    const stageFilter = journalRoot.querySelector('[data-journal-stage-filter]');
    const stageFilterToggle = journalRoot.querySelector('[data-journal-stage-filter-toggle]');
    const stageFilterMenu = journalRoot.querySelector('[data-journal-stage-filter-menu]');
    const selectionSummary = journalRoot.querySelector('[data-journal-selection-summary]');
    const selectedStageLabel = journalRoot.querySelector('[data-journal-selected-stage]');
    const selectedEmployeeLabel = journalRoot.querySelector('[data-journal-selected-employee]');
    const cardItems = Array.from(journalRoot.querySelectorAll('[data-journal-card]'));
    const panelItems = Array.from(journalRoot.querySelectorAll('[data-journal-panel]'));
    const placeholder = journalRoot.querySelector('[data-journal-placeholder]');
    const cardsEmptyState = journalRoot.querySelector('[data-journal-empty-cards]');
    const resultsEmptyState = journalRoot.querySelector('[data-journal-empty-results]');

    const readInitialValue = (buttons, attr) => buttons.find((button) => button.classList.contains('active'))?.dataset[attr] || buttons[0]?.dataset[attr] || 'all';

    const state = {
      search: searchInput ? searchInput.value.trim().toLowerCase() : '',
      stage: readInitialValue(stageButtons, 'journalStage'),
      employee: readInitialValue(employeeButtons, 'journalEmployee'),
      tab: readInitialValue(tabButtons, 'journalTab'),
      selectedCardId: '',
      employeeFilterOpen: false,
      stageFilterOpen: false
    };

    const stripDragState = {
      active: false,
      dragged: false,
      suppressClick: false,
      startX: 0,
      startScrollLeft: 0,
      pointerId: null
    };

    const setActiveButtons = (buttons, datasetKey, value) => {
      buttons.forEach((button) => {
        const isActive = button.dataset[datasetKey] === value;
        button.classList.toggle('active', isActive);
      });
    };

    const readActiveButtonLabel = (buttons) => {
      const activeButton = buttons.find((button) => button.classList.contains('active')) || buttons[0];
      const labelNode = activeButton ? activeButton.querySelector('.journal-pill-label') : null;
      return labelNode ? labelNode.textContent.trim() : '';
    };

    const matchesCard = (card) => {
      if (!card) {
        return false;
      }

      const cardStage = card.dataset.journalCardStage || 'all';
      const cardEmployee = card.dataset.journalCardEmployee || 'all';
      const cardSearch = card.dataset.journalCardSearch || '';
      const cardSubtypes = (card.dataset.journalCardSubtypes || '').split(/\s+/).filter(Boolean);
      const stageMatches = state.stage === 'all' || (state.stage === 'important' ? card.dataset.journalCardImportant === '1' : cardStage === state.stage);
      const employeeMatches = state.employee === 'all' || cardEmployee.split('|').some((employee) => employee.trim().toLowerCase() === state.employee.toLowerCase());
      const searchMatches = !state.search || cardSearch.includes(state.search);
      const tabMatches = state.tab === 'all' || cardSubtypes.includes(state.tab);

      return stageMatches && employeeMatches && searchMatches && tabMatches;
    };

    const syncSelection = (visibleCards) => {
      const selectedVisibleCard = visibleCards.find((card) => card.dataset.journalCardId === state.selectedCardId);
      if (selectedVisibleCard) {
        return;
      }

      state.selectedCardId = '';
    };

    const syncPanels = () => {
      panelItems.forEach((panel) => {
        const isActive = panel.dataset.journalPanelId === state.selectedCardId;
        panel.hidden = !isActive;
        panel.style.display = isActive ? 'grid' : 'none';
      });
    };

    const closeStageFilter = () => {
      state.stageFilterOpen = false;
      if (stageFilterMenu) {
        stageFilterMenu.hidden = true;
      }
      if (stageFilterToggle) {
        stageFilterToggle.setAttribute('aria-expanded', 'false');
      }
      if (stageFilter) {
        stageFilter.classList.remove('open');
      }
    };

    const closeEmployeeFilter = () => {
      state.employeeFilterOpen = false;
      if (employeeFilterMenu) {
        employeeFilterMenu.hidden = true;
      }
      if (employeeFilterToggle) {
        employeeFilterToggle.setAttribute('aria-expanded', 'false');
      }
      if (employeeFilter) {
        employeeFilter.classList.remove('open');
      }
    };

    const stopTabStripDrag = () => {
      stripDragState.active = false;
      stripDragState.dragged = false;
      stripDragState.pointerId = null;
      if (tabStrip) {
        tabStrip.classList.remove('is-dragging');
      }
    };

    const openStageFilter = () => {
      state.stageFilterOpen = true;
      if (stageFilterMenu) {
        stageFilterMenu.hidden = false;
      }
      if (stageFilterToggle) {
        stageFilterToggle.setAttribute('aria-expanded', 'true');
      }
      if (stageFilter) {
        stageFilter.classList.add('open');
      }
    };

    const openEmployeeFilter = () => {
      state.employeeFilterOpen = true;
      if (employeeFilterMenu) {
        employeeFilterMenu.hidden = false;
      }
      if (employeeFilterToggle) {
        employeeFilterToggle.setAttribute('aria-expanded', 'true');
      }
      if (employeeFilter) {
        employeeFilter.classList.add('open');
      }
    };

    const updateView = () => {
      const visibleCards = cardItems.filter(matchesCard);

      cardItems.forEach((card) => {
        const visible = matchesCard(card);
        card.hidden = !visible;
        card.classList.toggle('active', visible && card.dataset.journalCardId === state.selectedCardId);
      });

      syncSelection(visibleCards);
      setActiveButtons(stageButtons, 'journalStage', state.stage);
      setActiveButtons(employeeButtons, 'journalEmployee', state.employee);
      setActiveButtons(tabButtons, 'journalTab', state.tab);
      syncPanels();

      if (selectedStageLabel) {
        selectedStageLabel.textContent = readActiveButtonLabel(stageButtons) || 'Р’СЃРµ СЃС‚Р°РґРёРё';
      }
      if (selectedEmployeeLabel) {
        selectedEmployeeLabel.textContent = readActiveButtonLabel(employeeButtons) || 'Р’СЃРµ СЃРѕС‚СЂСѓРґРЅРёРєРё';
      }
      if (selectionSummary) {
        selectionSummary.hidden = false;
      }

      const hasVisibleCards = visibleCards.length > 0;
      if (placeholder) {
        placeholder.hidden = hasVisibleCards ? Boolean(state.selectedCardId) : true;
      }
      if (cardsEmptyState) {
        cardsEmptyState.hidden = false;
      }
      if (resultsEmptyState) {
        resultsEmptyState.hidden = hasVisibleCards;
      }

      if (stageFilterToggle) {
        stageFilterToggle.setAttribute('aria-expanded', String(state.stageFilterOpen));
      }
      if (employeeFilterToggle) {
        employeeFilterToggle.setAttribute('aria-expanded', String(state.employeeFilterOpen));
      }
    };

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.search = searchInput.value.trim().toLowerCase();
        updateView();
      });
    }

    if (tabStrip) {
      tabStrip.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
          return;
        }

        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }

        stripDragState.active = true;
        stripDragState.dragged = false;
        stripDragState.suppressClick = false;
        stripDragState.startX = event.clientX;
        stripDragState.startScrollLeft = tabStrip.scrollLeft;
        stripDragState.pointerId = event.pointerId;
      });

      tabStrip.addEventListener('pointermove', (event) => {
        if (!stripDragState.active || stripDragState.pointerId !== event.pointerId) {
          return;
        }

        const deltaX = event.clientX - stripDragState.startX;
        if (!stripDragState.dragged && Math.abs(deltaX) > 12) {
          stripDragState.dragged = true;
          stripDragState.suppressClick = true;
          tabStrip.classList.add('is-dragging');
          tabStrip.setPointerCapture(event.pointerId);
        }

        if (stripDragState.dragged) {
          event.preventDefault();
          tabStrip.scrollLeft = stripDragState.startScrollLeft - deltaX;
        }
      });

      const endDrag = (event) => {
        if (!stripDragState.active || stripDragState.pointerId !== event.pointerId) {
          return;
        }

        if (stripDragState.dragged && tabStrip.hasPointerCapture(event.pointerId)) {
          tabStrip.releasePointerCapture(event.pointerId);
        }

        stopTabStripDrag();
      };

      tabStrip.addEventListener('pointerup', endDrag);
      tabStrip.addEventListener('pointercancel', endDrag);
    }

    if (employeeFilterToggle) {
      employeeFilterToggle.addEventListener('click', () => {
        state.employeeFilterOpen = !state.employeeFilterOpen;
        if (state.employeeFilterOpen) {
          openEmployeeFilter();
          closeStageFilter();
        } else {
          closeEmployeeFilter();
        }
      });
    }

    if (stageFilterToggle) {
      stageFilterToggle.addEventListener('click', () => {
        state.stageFilterOpen = !state.stageFilterOpen;
        if (state.stageFilterOpen) {
          openStageFilter();
          closeEmployeeFilter();
        } else {
          closeStageFilter();
        }
      });
    }

    employeeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        state.employee = button.dataset.journalEmployee || 'all';
        closeEmployeeFilter();
        updateView();
      });
    });

    stageButtons.forEach((button) => {
      button.addEventListener('click', () => {
        state.stage = button.dataset.journalStage || 'all';
        closeStageFilter();
        updateView();
      });
    });

    tabButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        if (stripDragState.suppressClick) {
          event.preventDefault();
          event.stopPropagation();
          stripDragState.suppressClick = false;
          stopTabStripDrag();
          return;
        }

        state.tab = button.dataset.journalTab || 'all';
        closeStageFilter();
        updateView();
      });
    });

    cardItems.forEach((card) => {
      const selector = card.querySelector('[data-journal-select-card]');
      if (!selector) {
        return;
      }

      selector.addEventListener('click', () => {
        state.selectedCardId = card.dataset.journalCardId || '';
        updateView();
      });
    });

    document.addEventListener('click', (event) => {
      const target = event.target;
      const insideStage = stageFilter && stageFilter.contains(target);
      const insideEmployee = employeeFilter && employeeFilter.contains(target);

      if (!state.stageFilterOpen && !state.employeeFilterOpen) {
        return;
      }

      if (insideStage || insideEmployee) {
        return;
      }

      closeStageFilter();
      closeEmployeeFilter();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeStageFilter();
        closeEmployeeFilter();
      }
    });

    updateView();
  }

  const globalJournalRoot = document.querySelector('[data-global-journal-page]');
  if (globalJournalRoot) {
    const syncCustomRange = () => {
      const period = globalJournalRoot.querySelector('[data-global-journal-period]');
      const customRange = globalJournalRoot.querySelector('[data-global-journal-custom-range]');
      if (customRange && period) customRange.hidden = period.value !== 'custom';
    };

    const buildJournalUrl = (form) => {
      const url = new URL(form.action || window.location.href, window.location.href);
      const params = new URLSearchParams(new FormData(form));
      url.search = params.toString();
      return `${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ''}`;
    };

    const replaceOrRemove = (selector, nextDocument) => {
      const current = globalJournalRoot.querySelector(selector);
      const next = nextDocument.querySelector(selector);
      if (current && next) current.replaceWith(next);
      else if (current && !next) current.remove();
      else if (!current && next) {
        const layout = globalJournalRoot.querySelector('.global-journal-layout');
        if (layout) layout.before(next);
      }
    };

    const loadJournal = async (href, push = true) => {
      globalJournalRoot.classList.add('is-loading');
      try {
        const response = await fetch(href, { headers: { 'X-Requested-With': 'fetch' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const nextDocument = new DOMParser().parseFromString(html, 'text/html');
        const nextFilterPanel = nextDocument.querySelector('.global-journal-filter-panel');
        const currentFilterPanel = globalJournalRoot.querySelector('.global-journal-filter-panel');
        const nextResults = nextDocument.querySelector('.global-journal-results');
        const currentResults = globalJournalRoot.querySelector('.global-journal-results');
        if (!nextFilterPanel || !currentFilterPanel || !nextResults || !currentResults) throw new Error('Missing journal layout');

        currentFilterPanel.replaceWith(nextFilterPanel);
        replaceOrRemove('.global-journal-summary', nextDocument);
        currentResults.replaceWith(nextResults);
        if (push) window.history.pushState({ globalJournal: true }, '', href);
        syncCustomRange();
      } catch (error) {
        window.location.href = href;
      } finally {
        globalJournalRoot.classList.remove('is-loading');
      }
    };

    globalJournalRoot.addEventListener('submit', (event) => {
      const form = event.target.closest('.global-journal-filters');
      if (!form || !globalJournalRoot.contains(form) || !window.fetch || !window.DOMParser || !window.history) return;
      event.preventDefault();
      loadJournal(buildJournalUrl(form));
    });

    globalJournalRoot.addEventListener('change', (event) => {
      if (event.target.matches('[data-global-journal-period]')) {
        syncCustomRange();
      }
      if (event.target.matches('[data-global-journal-date]')) {
        const period = globalJournalRoot.querySelector('[data-global-journal-period]');
        if (period) period.value = 'custom';
        syncCustomRange();
      }
    });

    window.addEventListener('popstate', () => {
      if (window.location.pathname === '/journal' && window.fetch && window.DOMParser) {
        loadJournal(window.location.href, false);
      }
    });

    syncCustomRange();
  }

  const reportsFiltersRoot = document.querySelector('[data-reports-filters]');
  if (reportsFiltersRoot) {
    const form = reportsFiltersRoot.querySelector('.reports-filters-form');
    const employeeSelect = reportsFiltersRoot.querySelector('[data-reports-employee]');
    if (form && employeeSelect) {
      employeeSelect.addEventListener('change', () => {
        const url = new URL(form.action || window.location.href, window.location.href);
        url.searchParams.set('employee', employeeSelect.value);
        url.searchParams.delete('reportId');
        window.location.href = `${url.pathname}?${url.searchParams.toString()}`;
      });
    }
  }

  const lightbox = document.querySelector('.lightbox');
  if (!lightbox) return;

  const image = lightbox.querySelector('.lightbox-image');
  const closeButtons = lightbox.querySelectorAll('.lightbox-close, .lightbox-backdrop');
  const panel = lightbox.querySelector('.lightbox-panel');
  const metaLine = lightbox.querySelector('[data-photo-meta]');
  const title = lightbox.querySelector('[data-photo-title]');
  const subtitle = lightbox.querySelector('[data-photo-subtitle]');
  const eventLabel = lightbox.querySelector('[data-photo-event]');
  const detailsWrap = lightbox.querySelector('[data-photo-details-wrap]');
  const detailsGrid = lightbox.querySelector('[data-photo-details]');
  const journalLink = lightbox.querySelector('[data-photo-journal]');
  const navigation = lightbox.querySelector('[data-photo-navigation]');
  const prevButton = lightbox.querySelector('[data-photo-prev]');
  const nextButton = lightbox.querySelector('[data-photo-next]');
  const counter = lightbox.querySelector('[data-photo-counter]');

  let activePayload = null;
  let activeIndex = 0;
  let activeTrigger = null;

  function safeParsePayload(button) {
    if (button.dataset.photoPayload) {
      try {
        return JSON.parse(button.dataset.photoPayload);
      } catch (_error) {
        return null;
      }
    }

    if (button.dataset.photoUrl) {
        return {
          metaLine: '',
          title: '',
          subtitle: '',
          eventLabel: button.dataset.photoLabel || 'Фото',
          eventDetails: [],
          journalUrl: '',
          photos: [{ url: button.dataset.photoUrl, alt: button.dataset.photoLabel || 'Фото' }]
        };
    }

    return null;
  }

  function renderPhoto() {
    if (!activePayload || !Array.isArray(activePayload.photos) || !activePayload.photos.length) return;
    const photo = activePayload.photos[activeIndex] || activePayload.photos[0];
    image.src = photo.url;
    image.alt = photo.alt || activePayload.title || activePayload.eventLabel || 'Фото';
    if (metaLine) {
      metaLine.textContent = activePayload.metaLine || '';
      metaLine.hidden = !activePayload.metaLine;
    }
    if (title) {
      title.textContent = activePayload.title || '';
      title.hidden = !activePayload.title;
    }
    if (subtitle) {
      subtitle.textContent = activePayload.subtitle || '';
      subtitle.hidden = !activePayload.subtitle;
    }
    if (eventLabel) {
      eventLabel.textContent = activePayload.eventLabel || '';
      eventLabel.hidden = !activePayload.eventLabel;
    }
    if (detailsGrid) {
      detailsGrid.replaceChildren();
      const eventDetails = Array.isArray(activePayload.eventDetails) ? activePayload.eventDetails : [];
      eventDetails.forEach((item) => {
        if (!item || !item.label || !item.value) return;
        const row = document.createElement('div');
        row.className = 'photo-modal-detail-item';
        const dt = document.createElement('dt');
        dt.textContent = item.label;
        const dd = document.createElement('dd');
        dd.textContent = item.value;
        row.append(dt, dd);
        detailsGrid.append(row);
      });
      if (detailsWrap) {
        detailsWrap.hidden = detailsGrid.children.length === 0;
      }
    } else if (detailsWrap) {
      detailsWrap.hidden = true;
    }

    if (activePayload.journalUrl) {
      journalLink.hidden = false;
      journalLink.href = activePayload.journalUrl;
    } else {
      journalLink.hidden = true;
      journalLink.removeAttribute('href');
    }

    const photoCount = activePayload.photos.length;
    navigation.hidden = photoCount < 2;
    prevButton.disabled = activeIndex <= 0;
    nextButton.disabled = activeIndex >= photoCount - 1;
    counter.textContent = `${activeIndex + 1} / ${photoCount}`;
  }

  function open(payload, trigger) {
    activePayload = payload;
    activeIndex = 0;
    activeTrigger = trigger || null;
    renderPhoto();
    lightbox.hidden = false;
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    panel.focus();
  }

  function close() {
    lightbox.hidden = true;
    lightbox.setAttribute('aria-hidden', 'true');
    image.src = '';
    document.body.style.overflow = '';
    if (activeTrigger && typeof activeTrigger.focus === 'function') {
      activeTrigger.focus();
    }
    activePayload = null;
    activeIndex = 0;
    activeTrigger = null;
  }

  function move(step) {
    if (!activePayload || !Array.isArray(activePayload.photos)) return;
    const nextIndex = activeIndex + step;
    if (nextIndex < 0 || nextIndex >= activePayload.photos.length) return;
    activeIndex = nextIndex;
    renderPhoto();
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-photo-card], [data-photo-url]');
    if (!button) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const payload = safeParsePayload(button);
    if (payload) open(payload, button);
  });

  closeButtons.forEach((button) => {
    button.addEventListener('click', close);
  });

  if (prevButton) prevButton.addEventListener('click', () => move(-1));
  if (nextButton) nextButton.addEventListener('click', () => move(1));

  document.addEventListener('keydown', (event) => {
    if (lightbox.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(-1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(1);
    }
  });
})();

