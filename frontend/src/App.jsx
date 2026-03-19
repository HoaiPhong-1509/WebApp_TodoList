import React, { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from "./pages/HomePage";
import NotFound from './pages/NotFound';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import { AuthProvider } from '@/contexts/AuthContext';
import { GuestOnlyRoute, ProtectedRoute } from '@/components/AuthRouteGuards';

function ResponsiveToaster(props) {
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return 'top-right';
    return window.innerWidth < 640 ? 'top-center' : 'top-right';
  });

  useEffect(() => {
    function onResize() {
      setPosition(window.innerWidth < 640 ? 'top-center' : 'top-right');
    }

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return <Toaster {...props} position={position} />;
}

function App() {

  return (
    <>
      {/* Responsive Toaster: top-center on small screens, top-right on larger screens */}
      <ResponsiveToaster richColors />
   
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
