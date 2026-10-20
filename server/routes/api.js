import { Router } from 'express';
import { models } from '../models/index.js';
import { authenticate, adminOnly } from '../middleware/auth.js';
import * as controller from '../controllers/records.js';
export const apiRouter = Router();
apiRouter.use(authenticate);
apiRouter.get('/overview', controller.overview);
apiRouter.get('/dashboard', controller.overview);
apiRouter.get('/reports', controller.reports);
apiRouter.post('/actions/upgrade-members', adminOnly, controller.upgrade);
apiRouter.get('/stations/:id/availability', controller.checkAvailability);
apiRouter.get('/stations/:id/connectors', controller.connectors);
apiRouter.post('/bookings/:id/cancel', controller.transition('Cancelled'));
apiRouter.post('/bookings/:id/start', controller.transition('Charging'));
apiRouter.post('/bookings/:id/end', controller.transition('Completed'));
apiRouter.post('/bookings/:id/payment', controller.payment);
apiRouter.get('/charging-sessions', controller.history('charging_session'));
apiRouter.get('/payments', controller.history('payment'));
for (const kind of Object.keys(models)) {
  apiRouter.get(`/${kind}`, controller.listRecords(kind));
  apiRouter.get(`/${kind}/:id/delete-impact`, controller.impact(kind));
  apiRouter.get(`/${kind}/:id`, controller.getRecord(kind));
  apiRouter.post(`/${kind}`, controller.saveRecord(kind));
  apiRouter.put(`/${kind}/:id`, controller.saveRecord(kind));
  apiRouter.patch(`/${kind}/:id`, controller.saveRecord(kind));
  apiRouter.delete(`/${kind}/:id`, controller.deleteRecord(kind));
}
