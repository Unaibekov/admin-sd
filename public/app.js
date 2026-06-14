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
