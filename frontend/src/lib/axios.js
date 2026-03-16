import axios from "axios";
import { clearAuthToken, getAuthToken } from "@/lib/authToken";

const BASE_URL = import.meta.env.MODE === "development" ? 'http://localhost:5001/api' : '/api';

const api = axios.create({
    baseURL: BASE_URL,
    timeout: 40000,
});

api.interceptors.request.use((config) => {
    const token = getAuthToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401 && getAuthToken()) {
            clearAuthToken();

            const path = window.location.pathname;
            if (path !== '/login' && path !== '/register') {
                window.location.assign('/login');
            }
        }

        return Promise.reject(error);
    }
);

export default api;