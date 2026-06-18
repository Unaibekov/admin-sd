(function () {
  const uploadForm = document.querySelector('[data-upload-form]');
  if (uploadForm) {
    const uploadInput = uploadForm.querySelector('[data-upload-input]');
    const uploadTrigger = uploadForm.querySelector('[data-upload-trigger]');

    if (uploadInput && uploadTrigger) {
      uploadTrigger.addEventListener('click', () => {
        uploadInput.click();
      });

      uploadInput.addEventListener('change', () => {
        if (uploadInput.files && uploadInput.files.length > 0) {
          uploadForm.requestSubmit();
        }
      });
    }
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

  const journalRoot = document.querySelector('[data-journal-page]');
  if (journalRoot) {
    const searchInput = journalRoot.querySelector('[data-journal-search]');
    const stageButtons = Array.from(journalRoot.querySelectorAll('[data-journal-stage]'));
    const tabButtons = Array.from(journalRoot.querySelectorAll('[data-journal-tab]'));
    const stageFilter = journalRoot.querySelector('[data-journal-stage-filter]');
    const stageFilterToggle = journalRoot.querySelector('[data-journal-stage-filter-toggle]');
    const stageFilterMenu = journalRoot.querySelector('[data-journal-stage-filter-menu]');
    const cardItems = Array.from(journalRoot.querySelectorAll('[data-journal-card]'));
    const panelItems = Array.from(journalRoot.querySelectorAll('[data-journal-panel]'));
    const placeholder = journalRoot.querySelector('[data-journal-placeholder]');
    const cardsEmptyState = journalRoot.querySelector('[data-journal-empty-cards]');
    const resultsEmptyState = journalRoot.querySelector('[data-journal-empty-results]');

    const readInitialValue = (buttons, attr) => buttons.find((button) => button.classList.contains('active'))?.dataset[attr] || buttons[0]?.dataset[attr] || 'all';

    const state = {
      search: searchInput ? searchInput.value.trim().toLowerCase() : '',
      stage: readInitialValue(stageButtons, 'journalStage'),
      tab: readInitialValue(tabButtons, 'journalTab'),
      selectedCardId: '',
      stageFilterOpen: false
    };

    const setActiveButtons = (buttons, datasetKey, value) => {
      buttons.forEach((button) => {
        const isActive = button.dataset[datasetKey] === value;
        button.classList.toggle('active', isActive);
      });
    };

    const matchesCard = (card) => {
      if (!card) {
        return false;
      }

      const cardStage = card.dataset.journalCardStage || 'all';
      const cardSearch = card.dataset.journalCardSearch || '';
      const cardSubtypes = (card.dataset.journalCardSubtypes || '').split(/\s+/).filter(Boolean);
      const stageMatches = state.stage === 'all' || (state.stage === 'important' ? card.dataset.journalCardImportant === '1' : cardStage === state.stage);
      const searchMatches = !state.search || cardSearch.includes(state.search);
      const tabMatches = state.tab === 'all' || cardSubtypes.includes(state.tab);

      return stageMatches && searchMatches && tabMatches;
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

    const updateView = () => {
      const visibleCards = cardItems.filter(matchesCard);

      cardItems.forEach((card) => {
        const visible = matchesCard(card);
        card.hidden = !visible;
        card.classList.toggle('active', visible && card.dataset.journalCardId === state.selectedCardId);
      });

      syncSelection(visibleCards);
      setActiveButtons(stageButtons, 'journalStage', state.stage);
      setActiveButtons(tabButtons, 'journalTab', state.tab);
      syncPanels();

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
    };

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.search = searchInput.value.trim().toLowerCase();
        updateView();
      });
    }

    if (stageFilterToggle) {
      stageFilterToggle.addEventListener('click', () => {
        state.stageFilterOpen = !state.stageFilterOpen;
        if (state.stageFilterOpen) {
          openStageFilter();
        } else {
          closeStageFilter();
        }
      });
    }

    stageButtons.forEach((button) => {
      button.addEventListener('click', () => {
        state.stage = button.dataset.journalStage || 'all';
        closeStageFilter();
        updateView();
      });
    });

    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
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
      if (!state.stageFilterOpen || !stageFilter) {
        return;
      }

      if (stageFilter.contains(event.target)) {
        return;
      }

      closeStageFilter();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeStageFilter();
      }
    });

    updateView();
  }

  const lightbox = document.querySelector('.lightbox');
  if (!lightbox) return;

  const image = lightbox.querySelector('.lightbox-image');
  const caption = lightbox.querySelector('.lightbox-caption');
  const closeButtons = lightbox.querySelectorAll('.lightbox-close, .lightbox-backdrop');
  const thumbButtons = document.querySelectorAll('[data-photo-url]');

  function open(url, label) {
    image.src = url;
    image.alt = label || '';
    caption.textContent = label || '';
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function close() {
    lightbox.hidden = true;
    image.src = '';
    caption.textContent = '';
    document.body.style.overflow = '';
  }

  thumbButtons.forEach((button) => {
    button.addEventListener('click', () => {
      open(button.dataset.photoUrl, button.dataset.photoLabel);
    });
  });

  closeButtons.forEach((button) => {
    button.addEventListener('click', close);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !lightbox.hidden) {
      close();
    }
  });
})();
