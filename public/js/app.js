// Маршрутизация по pathname
(function () {
  const path = window.location.pathname;
  let view = 'guest';

  if (path === '/player') view = 'player';
  else if (path === '/host') view = 'host';

  document.body.dataset.view = view;

  // Загрузка соответствующего скрипта
  const script = document.createElement('script');
  script.src = `/js/${view}.js`;
  script.async = false;
  document.body.appendChild(script);
})();
