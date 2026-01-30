export const generateId = () => Math.floor(Math.random() * 10000000);

export const getCurrentDate = () => {
    const now = new Date();
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
    return `${now.toLocaleDateString()}(${day})${now.toLocaleTimeString()}`;
};

export const generateTripcode = () => Math.random().toString(36).substring(2, 9);
