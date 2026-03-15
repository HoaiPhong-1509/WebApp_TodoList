import { Toaster } from 'sonner';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from "./pages/HomePage";
import NotFound from './pages/NotFound';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import { AuthProvider } from '@/contexts/AuthContext';
import { GuestOnlyRoute, ProtectedRoute } from '@/components/AuthRouteGuards';

function App() {

  return (
    <>
      <Toaster richColors/>
   
      <BrowserRouter>
        <AuthProvider>
 
        <Routes>

          <Route
            path="/"
            element={(
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/login"
            element={(
              <GuestOnlyRoute>
                <LoginPage />
              </GuestOnlyRoute>
            )}
          />
          <Route
            path="/register"
            element={(
              <GuestOnlyRoute>
                <RegisterPage />
              </GuestOnlyRoute>
            )}
          />
          <Route
            path="/verify-email"
            element={(
              <GuestOnlyRoute>
                <VerifyEmailPage />
              </GuestOnlyRoute>
            )}
          />
          <Route path="*" element={<NotFound />} />

        </Routes>

        </AuthProvider>

      </BrowserRouter>
     
    </>
  );
}

export default App
