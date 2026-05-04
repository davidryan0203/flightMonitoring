const JSON_HEADERS = {
  'Content-Type': 'application/json',
};

async function parseJsonOrThrow(response) {
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

export async function fetchAdminState() {
  const response = await fetch('/api/admin/state');
  return parseJsonOrThrow(response);
}

export async function updateDisplaySettings(settings) {
  const response = await fetch('/api/admin/display-settings', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(settings),
  });
  return parseJsonOrThrow(response);
}

export async function createCustomFlight(type, payload) {
  const response = await fetch(`/api/admin/flights/${type}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(response);
}

export async function updateCustomFlight(type, id, payload) {
  const response = await fetch(`/api/admin/flights/${type}/${id}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(response);
}

export async function deleteCustomFlight(type, id) {
  const response = await fetch(`/api/admin/flights/${type}/${id}`, {
    method: 'DELETE',
  });
  return parseJsonOrThrow(response);
}

export async function triggerServerRefresh() {
  const response = await fetch('/api/refresh', {
    method: 'POST',
  });
  return parseJsonOrThrow(response);
}
