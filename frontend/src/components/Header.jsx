import React from 'react'
import { Button } from './ui/button';
import { Bell, CheckCheck, UserCircle2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Input } from './ui/input';
import { toast } from 'sonner';

const formatRelativeTime = (value) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return 'vừa xong';
  }

  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)} phút trước`;
  }

  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)} giờ trước`;
  }

  return `${Math.floor(diffMs / day)} ngày trước`;
};

export const Header = ({
  appName = 'Task Management App',
  user,
  userName,
  onLogout,
  onChangePassword,
  notificationCount = 0,
  workspaceName = 'Primary Workspace',
  workspaceNotifications = [],
  onMarkAllNotificationsRead,
  isMarkingNotificationsRead = false,
}) => {
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [isChangingPassword, setIsChangingPassword] = React.useState(false);

  const joinedAtLabel = React.useMemo(() => {
    if (!user?.createdAt) {
      return 'N/A';
    }
    const date = new Date(user.createdAt);
    if (Number.isNaN(date.getTime())) {
      return 'N/A';
    }
    return date.toLocaleString();
  }, [user?.createdAt]);

  const passwordLastChangedLabel = React.useMemo(() => {
    if (!user?.lastPasswordChangedAt) {
      return 'Never changed';
    }
    const date = new Date(user.lastPasswordChangedAt);
    if (Number.isNaN(date.getTime())) {
      return 'Unknown';
    }
    return date.toLocaleString();
  }, [user?.lastPasswordChangedAt]);

  const passwordCooldownInfo = React.useMemo(() => {
    if (!user?.lastPasswordChangedAt) {
      return {
        canChange: true,
        nextAllowedLabel: 'Now',
      };
    }

    const lastChanged = new Date(user.lastPasswordChangedAt);
    if (Number.isNaN(lastChanged.getTime())) {
      return {
        canChange: true,
        nextAllowedLabel: 'Now',
      };
    }

    const nextAllowedAt = new Date(lastChanged.getTime() + 3 * 24 * 60 * 60 * 1000);
    const remainingMs = nextAllowedAt.getTime() - Date.now();

    if (remainingMs <= 0) {
      return {
        canChange: true,
        nextAllowedLabel: 'Now',
      };
    }

    const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));

    return {
      canChange: false,
      nextAllowedLabel: `${nextAllowedAt.toLocaleString()} (${remainingHours}h left)`,
    };
  }, [user?.lastPasswordChangedAt]);

  const handleSubmitChangePassword = async (event) => {
    event.preventDefault();

    if (!onChangePassword) {
      toast.error('Change password is unavailable right now.');
      return;
    }

    if (!passwordCooldownInfo.canChange) {
      toast.error('You can only change password once every 3 days.');
      return;
    }

    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Please fill all password fields.');
      return;
    }

    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('Confirm password does not match.');
      return;
    }

    try {
      setIsChangingPassword(true);
      await onChangePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to change password.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  return <div className='space-y-3'>

    <div className='flex flex-col gap-3 rounded-2xl bg-transparent p-4 md:flex-row md:items-center md:justify-between'>
      <div className='space-y-1'>
        <p className='text-[11px] font-semibold uppercase tracking-[0.24em] text-violet-800'>
          {workspaceName}
        </p>
        <h1 className='text-2xl font-black text-violet-900 sm:text-[2rem]'>
          {appName}
        </h1>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type='button'
              className='inline-flex cursor-pointer items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-violet-50'
            >
              <UserCircle2 className='size-4 text-slate-500' />
              <span className='font-medium'>{userName}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align='end'
            className='sm:w-[min(94vw,420px)] w-[calc(100%-2rem)] border-white/80 bg-white/75 p-3 shadow-xl backdrop-blur-xl supports-[backdrop-filter]:bg-white/65'
          >
            <div className='space-y-3'>
              <div>
                <p className='text-sm font-semibold text-slate-900'>Account Information</p>
                <p className='mt-0.5 text-xs text-slate-500'>Profile details and password security settings</p>
              </div>

              <div className='grid grid-cols-1 gap-2 rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-xs text-slate-700'>
                <p><span className='font-semibold text-slate-900'>Name:</span> {user?.name || userName}</p>
                <p><span className='font-semibold text-slate-900'>Email:</span> {user?.email || 'N/A'}</p>
                <p><span className='font-semibold text-slate-900'>User ID:</span> {user?.id || 'N/A'}</p>
                <p><span className='font-semibold text-slate-900'>Email verification:</span> {user?.isVerified ? 'Verified' : 'Not verified'}</p>
                <p><span className='font-semibold text-slate-900'>Joined at:</span> {joinedAtLabel}</p>
                <p><span className='font-semibold text-slate-900'>Last password change:</span> {passwordLastChangedLabel}</p>
                <p><span className='font-semibold text-slate-900'>Next password change:</span> {passwordCooldownInfo.nextAllowedLabel}</p>
              </div>

              <form className='space-y-2 rounded-lg border border-slate-200 bg-white p-3' onSubmit={handleSubmitChangePassword}>
                <p className='text-sm font-semibold text-slate-900'>Change Password</p>
                <Input
                  type='password'
                  placeholder='Current password'
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  disabled={!passwordCooldownInfo.canChange || isChangingPassword}
                />
                <Input
                  type='password'
                  placeholder='New password'
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  disabled={!passwordCooldownInfo.canChange || isChangingPassword}
                />
                <Input
                  type='password'
                  placeholder='Confirm new password'
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  disabled={!passwordCooldownInfo.canChange || isChangingPassword}
                />
                <Button
                  type='submit'
                  size='sm'
                  className='w-full cursor-pointer'
                  disabled={!passwordCooldownInfo.canChange || isChangingPassword}
                >
                  {isChangingPassword ? 'Updating password...' : 'Update Password'}
                </Button>
                {!passwordCooldownInfo.canChange && (
                  <p className='text-xs text-amber-700'>Password can only be changed once every 3 days.</p>
                )}
              </form>
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type='button'
              className='inline-flex cursor-pointer items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-violet-50'
            >
              <Bell className='size-4 text-primary' />
              <span>{notificationCount} notifications</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align='end'
            className='sm:w-[360px] w-[calc(100%-2rem)] border-white/80 bg-white/75 p-3 shadow-xl backdrop-blur-xl supports-[backdrop-filter]:bg-white/65'
          >
            <div className='flex items-center justify-between gap-2'>
              <div>
                <p className='text-sm font-semibold text-slate-900'>Thông báo workspace</p>
                <p className='mt-0.5 text-xs text-slate-500'>Tổng hợp thay đổi lớn từ thành viên khác</p>
              </div>
              <Button
                type='button'
                variant='outline'
                size='icon-sm'
                className='size-8 border-violet-200 bg-white hover:bg-violet-50'
                disabled={notificationCount === 0 || isMarkingNotificationsRead}
                onClick={onMarkAllNotificationsRead}
                aria-label='Đánh dấu tất cả đã xem'
                title='Đánh dấu tất cả đã xem'
              >
                <CheckCheck className='size-4' />
              </Button>
            </div>

            {workspaceNotifications.length === 0 ? (
              <p className='mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500'>
                Chưa có thông báo mới.
              </p>
            ) : (
              <div className='mt-3 max-h-72 space-y-2 overflow-y-auto pr-1'>
                {workspaceNotifications.map((item) => (
                  <div key={item.workspaceId} className='rounded-lg border border-violet-100 bg-violet-50/50 p-2.5'>
                    <p className='truncate text-sm font-semibold text-slate-900'>{item.workspaceName}</p>
                    <p className='mt-1 text-xs text-slate-700'>
                      {item.majorChangeCount > 0
                        ? `${item.workspaceName} có ${item.majorChangeCount} lần thay đổi lớn.`
                        : `${item.workspaceName} không có thay đổi lớn.`}
                    </p>
                    {item.newMemberCount > 0 ? (
                      <p className='mt-1 text-xs text-slate-700'>
                        {item.workspaceName} có thêm {item.newMemberCount} thành viên mới.
                      </p>
                    ) : null}
                    <p className='mt-1 text-[11px] text-slate-500'>{formatRelativeTime(item.latestActivityAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>

        <Button variant='outline' size='sm' className='cursor-pointer border-violet-200 bg-white hover:bg-violet-50' onClick={onLogout}>Logout</Button>
      </div>
    </div>

  </div>
}

export default Header